import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  determineActiveBundles,
  pruneToolSchemas,
  discoverDenseContext,
  executePreflight,
  isLowMemorySystem,
  TOOL_BUNDLES,
} from '../src/modules/hybrid/index.js';
import type { ToolDefinition } from '../src/types.js';

describe('Hybrid Orchestration - Tool Pruning (Risk 2 Mitigation)', () => {
  const dummyTools: ToolDefinition[] = [
    { name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
    { name: 'write_file', description: 'Write a file', parameters: { type: 'object' } },
    { name: 'edit_file', description: 'Edit a file', parameters: { type: 'object' } },
    { name: 'apply_patch', description: 'Apply a patch', parameters: { type: 'object' } },
    { name: 'read_blob', description: 'Read a blob', parameters: { type: 'object' } },
    { name: 'run_command', description: 'Run a shell command', parameters: { type: 'object' } },
    { name: 'generate_image', description: 'Generate an image', parameters: { type: 'object' } },
    { name: 'websearch', description: 'Search the web', parameters: { type: 'object' } },
    { name: 'mcp_custom_tool', description: 'Custom MCP extension', parameters: { type: 'object' } },
  ];

  it('CORE_EDITING is immutable and always active', () => {
    const bundles = determineActiveBundles('Hello world, simple question');
    expect(bundles).toContain('CORE_EDITING');
    expect(bundles).not.toContain('MEDIA');
    expect(bundles).not.toContain('TERMINAL');
  });

  it('activates TERMINAL bundle when prompt mentions running tests or build', () => {
    const bundles = determineActiveBundles('Please run the test suite and build the package');
    expect(bundles).toContain('TERMINAL');
    expect(bundles).toContain('CORE_EDITING');
  });

  it('activates MEDIA bundle only when media is explicitly requested', () => {
    const withoutMedia = determineActiveBundles('Refactor auth module');
    expect(withoutMedia).not.toContain('MEDIA');

    const withMedia = determineActiveBundles('Generate an image of the architecture diagram');
    expect(withMedia).toContain('MEDIA');
  });

  it('activates EXPLORATION when CodeGraph confidence is low (< 15)', () => {
    const bundlesLow = determineActiveBundles('Do something', 5);
    expect(bundlesLow).toContain('EXPLORATION');

    const bundlesHigh = determineActiveBundles('Do something', 25);
    expect(bundlesHigh).not.toContain('EXPLORATION');
  });

  it('pruneToolSchemas never prunes CORE_EDITING tools under any circumstance', () => {
    const { activeToolNames } = pruneToolSchemas(dummyTools, ['CORE_EDITING']);
    for (const coreTool of TOOL_BUNDLES.CORE_EDITING) {
      expect(activeToolNames).toContain(coreTool);
    }
  });

  it('prunes inactive tools and computes saved schema tokens', () => {
    const { prunedTokens, prunedToolNames } = pruneToolSchemas(dummyTools, ['CORE_EDITING']);
    expect(prunedToolNames).toContain('generate_image');
    expect(prunedToolNames).toContain('run_command');
    expect(prunedTokens).toBeGreaterThan(0);
  });

  it('preserves custom MCP tools not belonging to any predefined bundle', () => {
    const { activeToolNames } = pruneToolSchemas(dummyTools, ['CORE_EDITING']);
    expect(activeToolNames).toContain('mcp_custom_tool');
  });
});

describe('Hybrid Orchestration - Code Discovery & Capsule (Risk 1 Mitigation)', () => {
  const tempWorkspace = path.join(os.tmpdir(), `mugil-test-discovery-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(tempWorkspace, { recursive: true });
    // Write sample files with discernible symbols
    fs.writeFileSync(
      path.join(tempWorkspace, 'authService.ts'),
      `export class AuthService {
  login(user: string, pass: string): boolean {
    return true;
  }
  logout(): void {}
}`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempWorkspace, 'userModel.ts'),
      `export interface UserProfile {
  id: string;
  name: string;
}`,
      'utf8',
    );
  });

  afterAll(() => {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('discovers symbols and builds a bounded dense context capsule', async () => {
    const { capsule, confidence } = await discoverDenseContext(
      tempWorkspace,
      'Refactor login in AuthService',
      { maxTokens: 800 },
    );

    expect(confidence).toBeGreaterThan(0);
    expect(capsule.discoveredSymbols.length).toBeGreaterThan(0);
    expect(capsule.openDoorContract).toContain('AuthService');
    expect(capsule.openDoorContract).toContain('call read_file');
    expect(capsule.contextSnippet).toContain('login');
  });
});

describe('Hybrid Orchestration - Pre-flight & RAM Gating (Risk 3 Mitigation)', () => {
  const tempWorkspace = path.join(os.tmpdir(), `mugil-test-orch-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(tempWorkspace, { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, 'config.ts'), 'export const PORT = 3000;', 'utf8');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('detects low memory condition when forced by environment flag', () => {
    expect(isLowMemorySystem({ MUGIL_IDE_FORCE_0RAM_PREFLIGHT: '1' })).toBe(true);
  });

  it('executes 0-RAM Algorithmic Pre-Flight mode when local model is not running', async () => {
    const mockLlama: any = {
      isRunning: () => false,
    };

    const dummyTools: ToolDefinition[] = [
      { name: 'read_file', description: 'Read a file', parameters: {} },
      { name: 'write_file', description: 'Write a file', parameters: {} },
      { name: 'edit_file', description: 'Edit a file', parameters: {} },
      { name: 'apply_patch', description: 'Apply patch', parameters: {} },
      { name: 'read_blob', description: 'Read blob', parameters: {} },
      { name: 'generate_image', description: 'Generate image', parameters: {} },
    ];

    const result = await executePreflight({
      workspaceDir: tempWorkspace,
      prompt: 'Check PORT in config.ts',
      allTools: dummyTools,
      llamaManager: mockLlama,
      env: { MUGIL_IDE_FORCE_0RAM_PREFLIGHT: '1' },
    });

    expect(result.mode).toBe('algorithmic-0ram');
    expect(result.capsule).toBeDefined();
    expect(result.prunedToolTokens).toBeGreaterThan(0);
    expect(result.activeBundles).toContain('CORE_EDITING');
  });
});
