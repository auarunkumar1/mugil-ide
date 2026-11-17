import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  appDataDir,
  modelsDir,
  vendorDir,
  pidFile,
  probeHardware,
  evaluateHardware,
  MODEL_CATALOG,
  recommendModels,
  downloadFile,
  buildServerArgs,
  listInstalledModels,
  deleteInstalledModel,
  LlamaServerManager,
  reapStaleProcess,
} from '../src/modules/llamacpp/index.js';

describe('llamacpp paths', () => {
  it('appDataDir is rooted at dirname of userEnvPath', () => {
    const customEnv = { MUGIL_IDE_ENV_FILE: '/custom/data/dir/.env' };
    expect(appDataDir(customEnv)).toBe('/custom/data/dir');
  });

  it('modelsDir respects MUGIL_IDE_MODELS_DIR override', () => {
    const customEnv = {
      MUGIL_IDE_ENV_FILE: '/app/data/.env',
      MUGIL_IDE_MODELS_DIR: '/mnt/storage/models',
    };
    expect(modelsDir(customEnv)).toBe('/mnt/storage/models');
  });

  it('vendorDir constructs build and variant path', () => {
    const customEnv = { MUGIL_IDE_ENV_FILE: '/app/data/.env' };
    expect(vendorDir(12451, 'cpu', customEnv)).toBe(
      path.join('/app/data', 'vendor', 'llama.cpp', 'b12451-cpu'),
    );
  });

  it('pidFile is inside appDataDir', () => {
    const customEnv = { MUGIL_IDE_ENV_FILE: '/app/data/.env' };
    expect(pidFile(customEnv)).toBe(path.join('/app/data', 'llama-server.pid'));
  });
});

describe('llamacpp hardware & tier evaluation', () => {
  it('detects Apple Silicon Metal from darwin + arm64', async () => {
    const profile = await probeHardware({ platform: 'darwin', arch: 'arm64', totalRamGb: 32 });
    expect(profile.gpu).toBe('metal');
    expect(profile.vramGb).toBe(32);

    const evalResult = evaluateHardware(profile);
    expect(evalResult.tier).toBe('tier1_workstation');
    expect(evalResult.recommendedTopology).toBe('local-only');
  });

  it('evaluates low-spec CPU machine to tier3_constrained with hybrid-orchestrated', async () => {
    const profile = await probeHardware({
      platform: 'linux',
      arch: 'x64',
      totalRamGb: 8,
      availableRamGb: 4,
      gpu: 'cpu',
    });
    expect(profile.gpu).toBe('cpu');

    const evalResult = evaluateHardware(profile);
    expect(evalResult.tier).toBe('tier3_constrained');
    expect(evalResult.recommendedTopology).toBe('hybrid-orchestrated');
    expect(evalResult.recommendedLocalModelId).toBe('qwen2.5-coder-1.5b-q4km');
  });

  it('evaluates dedicated NVIDIA GPU with 24GB VRAM to tier1_workstation', async () => {
    const profile = await probeHardware({
      platform: 'linux',
      arch: 'x64',
      totalRamGb: 32,
      availableRamGb: 20,
      gpu: 'cuda',
      vramGb: 24,
    });
    const evalResult = evaluateHardware(profile);
    expect(evalResult.tier).toBe('tier1_workstation');
    expect(evalResult.recommendedTopology).toBe('local-only');
  });
});

describe('llamacpp catalog & recommendation', () => {
  it('catalog models have positive sizeBytes and unique IDs', () => {
    const ids = new Set<string>();
    for (const m of MODEL_CATALOG) {
      expect(m.sizeBytes).toBeGreaterThan(0);
      expect(m.sha256).toBeDefined();
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
    }
  });

  it('recommendModels excludes models exceeding available RAM', () => {
    const lowRamProfile = {
      platform: 'linux' as NodeJS.Platform,
      arch: 'x64',
      totalRamGb: 8,
      availableRamGb: 4.8,
      cpuCores: 8,
      gpu: 'cpu' as const,
    };
    const recommended = recommendModels(lowRamProfile);
    expect(recommended.length).toBeGreaterThan(0);
    for (const m of recommended) {
      expect(m.minRamGb).toBeLessThanOrEqual(lowRamProfile.availableRamGb);
    }
    // 30B MoE requires 24GB, so it must not be recommended for 4.8GB available
    expect(recommended.some((m) => m.id === 'qwen3-coder-30b-a3b-q4km')).toBe(false);
  });
});

describe('llamacpp download', () => {
  const tempDir = path.join(os.tmpdir(), `mugil-test-dl-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('downloads file, checks sha256, and renames atomically', async () => {
    const content = 'hello llama.cpp world';
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const dest = path.join(tempDir, 'test-file.bin');

    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(content.length) }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        },
      }),
    } as unknown as Response);

    const result = await downloadFile({
      url: 'https://example.com/model.bin',
      dest,
      sha256,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    expect(result.path).toBe(dest);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(fs.readFileSync(dest, 'utf-8')).toBe(content);
  });

  it('deletes part file and throws if sha256 does not match', async () => {
    const content = 'corrupted bytes';
    const wrongSha256 = '0000000000000000000000000000000000000000000000000000000000000000';
    const dest = path.join(tempDir, 'bad-file.bin');

    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(content.length) }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        },
      }),
    } as unknown as Response);

    await expect(
      downloadFile({
        url: 'https://example.com/bad.bin',
        dest,
        sha256: wrongSha256,
        fetchFn: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/SHA-256 verification failed/);

    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });
});

describe('llamacpp server args & models store', () => {
  const testEnvDir = path.join(os.tmpdir(), `mugil-test-models-${Date.now()}`);
  const modelsPath = path.join(testEnvDir, 'models');
  const mockEnv = {
    MUGIL_IDE_ENV_FILE: path.join(testEnvDir, '.env'),
    MUGIL_IDE_MODELS_DIR: modelsPath,
  };

  beforeAll(() => {
    fs.mkdirSync(modelsPath, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(testEnvDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('buildServerArgs generates expected flags', () => {
    const args = buildServerArgs({
      modelPath: '/path/to/model.gguf',
      port: 8080,
      ctx: 4096,
      gpuLayers: 33,
      alias: 'custom-alias',
      threads: 4,
    });

    expect(args).toEqual([
      '-m',
      '/path/to/model.gguf',
      '--host',
      '127.0.0.1',
      '--port',
      '8080',
      '-c',
      '4096',
      '-ngl',
      '33',
      '-a',
      'custom-alias',
      '--jinja',
      '-np',
      '1',
      '-fa',
      'on',
      '--cache-reuse',
      '256',
      '-t',
      '4',
    ]);
  });

  it('listInstalledModels discovers .gguf files and ignores others', async () => {
    fs.writeFileSync(path.join(modelsPath, 'model-a.gguf'), 'fake-weights-a');
    fs.writeFileSync(path.join(modelsPath, 'notes.txt'), 'ignore me');

    const installed = await listInstalledModels(mockEnv);
    expect(installed.length).toBe(1);
    expect(installed[0]?.file).toBe('model-a.gguf');
    expect(installed[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('deleteInstalledModel refuses directory traversal attack', async () => {
    await expect(deleteInstalledModel('../../etc/passwd', mockEnv)).rejects.toThrow(
      /Path traversal denied/,
    );
  });

  it('deleteInstalledModel successfully deletes an existing model', async () => {
    const target = path.join(modelsPath, 'to-delete.gguf');
    fs.writeFileSync(target, 'temporary');
    expect(fs.existsSync(target)).toBe(true);

    await deleteInstalledModel('to-delete.gguf', mockEnv);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('LlamaServerManager lifecycle', () => {
  const testDir = path.join(os.tmpdir(), `mugil-test-mgr-${Date.now()}`);
  const modelFile = path.join(testDir, 'dummy.gguf');
  const mockEnv = {
    MUGIL_IDE_ENV_FILE: path.join(testDir, '.env'),
  };

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(modelFile, 'dummy weights');
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('throws immediately if model file does not exist', async () => {
    const mgr = new LlamaServerManager({ env: mockEnv });
    await expect(
      mgr.start({
        modelPath: '/non/existent/model.gguf',
      }),
    ).rejects.toThrow(/model file not found/);
    expect(mgr.status().state).toBe('error');
  });

  it('fails fast with stderr tail if child exits prematurely', async () => {
    // Create a mock child process that exits immediately with error
    const fakeChild = new EventEmitter() as any;
    fakeChild.pid = 99999;
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill = jest.fn();

    const fakeSpawn = jest.fn().mockImplementation(() => {
      setTimeout(() => {
        fakeChild.stderr.emit('data', Buffer.from('error loading model: invalid magic bytes\n'));
        fakeChild.emit('exit', 1, null);
      }, 50);
      return fakeChild;
    });

    const mgr = new LlamaServerManager({
      env: mockEnv,
      spawnFn: fakeSpawn,
      fetchFn: jest.fn().mockRejectedValue(new Error('connection refused')),
      startupTimeoutMs: 10_000,
    });

    await expect(
      mgr.start({
        modelPath: modelFile,
        port: 8888,
        binaryPath: '/bin/true',
      }),
    ).rejects.toThrow(/error loading model/);

    expect(mgr.status().state).toBe('error');
  });

  it('starts successfully when health returns 200 and stops cleanly', async () => {
    const fakeChild = new EventEmitter() as any;
    fakeChild.pid = 12345;
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill = jest.fn().mockImplementation((sig) => {
      fakeChild.emit('exit', 0, sig);
    });

    const fakeSpawn = jest.fn().mockReturnValue(fakeChild);
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    });

    const mgr = new LlamaServerManager({
      env: mockEnv,
      spawnFn: fakeSpawn,
      fetchFn: fakeFetch as unknown as typeof fetch,
      startupTimeoutMs: 5_000,
    });

    const status = await mgr.start({
      modelPath: modelFile,
      port: 8888,
      binaryPath: '/bin/true',
    });

    expect(status.state).toBe('running');
    expect(status.port).toBe(8888);
    expect(status.baseUrl).toBe('http://127.0.0.1:8888/v1');

    // Test stop
    await mgr.stop();
    expect(mgr.status().state).toBe('stopped');
  });

  it('stop() terminates process from pidFile even when manager is in stopped state', async () => {
    const pFile = pidFile(mockEnv);
    fs.writeFileSync(pFile, '77777');
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((_pid, _sig) => true as any);

    try {
      const mgr = new LlamaServerManager({ env: mockEnv });
      expect(mgr.status().state).toBe('stopped');

      await mgr.stop();
      expect(killSpy).toHaveBeenCalledWith(77777, 'SIGTERM');
      expect(fs.existsSync(pFile)).toBe(false);
    } finally {
      killSpy.mockRestore();
    }
  });

  it('killSync() sends SIGKILL to candidate PID from pidFile even when child is undefined', () => {
    const pFile = pidFile(mockEnv);
    fs.writeFileSync(pFile, '88888');
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((_pid, _sig) => true as any);

    try {
      const mgr = new LlamaServerManager({ env: mockEnv });
      mgr.killSync();

      expect(killSpy).toHaveBeenCalledWith(88888, 'SIGKILL');
      expect(fs.existsSync(pFile)).toBe(false);
    } finally {
      killSpy.mockRestore();
    }
  });

  it('reapStaleProcess() cleans up pidFile and signals processes', async () => {
    const pFile = pidFile(mockEnv);
    fs.writeFileSync(pFile, '99999');
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((_pid, _sig) => {
      throw new Error('ESRCH');
    });

    try {
      await reapStaleProcess(mockEnv);
      expect(fs.existsSync(pFile)).toBe(false);
    } finally {
      killSpy.mockRestore();
    }
  });
});
