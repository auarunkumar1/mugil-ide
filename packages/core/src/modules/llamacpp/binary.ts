import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { vendorDir, ensureDir } from './paths.js';
import { downloadFile } from './download.js';

const execFileAsync = promisify(execFile);

export const LLAMA_CPP_BUILD = 12451;

export type BinaryVariant = 'cpu' | 'cuda' | 'vulkan';

interface PlatformAsset {
  asset: string;
  sha256?: string;
  isZip?: boolean;
}

const ASSET_MAP: Record<string, PlatformAsset> = {
  'linux-x64-cpu': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-ubuntu-x64.tar.gz`,
    sha256: '6604b91dd7220923d6e085f619cdf67253adeb3e855581d86bef7720f0274cbf',
  },
  'linux-x64-cuda': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  },
  'linux-x64-vulkan': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`,
  },
  'linux-arm64-cpu': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-ubuntu-arm64.tar.gz`,
  },
  'darwin-arm64-metal': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-macos-arm64.tar.gz`,
    sha256: 'a11416282af8e0aa8fe9f91d3bd4af07a60f18210c799b789ee163a6ed45d936',
  },
  'darwin-x64-cpu': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-macos-x64.tar.gz`,
  },
  'win32-x64-cpu': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-win-cpu-x64.zip`,
    sha256: '4743c1ad134675975bd987f98c202e576bbb0db1fae9a39fee9832200b07c46e',
    isZip: true,
  },
  'win32-x64-cuda': {
    asset: `llama-b${LLAMA_CPP_BUILD}-bin-win-cuda-12.4-x64.zip`,
    isZip: true,
  },
};

export function resolvePlatformKey(
  platform = process.platform,
  arch = process.arch,
  variant: BinaryVariant = 'cpu',
): string {
  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64-metal';
  }
  return `${platform}-${arch}-${variant}`;
}

export function binaryPath(variant: BinaryVariant = 'cpu', env = process.env): string {
  if (env.LLAMA_SERVER_BIN) {
    return env.LLAMA_SERVER_BIN;
  }
  const vDir = vendorDir(LLAMA_CPP_BUILD, variant, env);
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

  // Release archive unpacks to a nested directory: llama-b<BUILD>/llama-server
  const nestedPath = path.join(vDir, `llama-b${LLAMA_CPP_BUILD}`, exeName);
  if (fs.existsSync(nestedPath)) return nestedPath;

  // Direct unpacked fallback
  return path.join(vDir, exeName);
}

export function isInstalled(variant: BinaryVariant = 'cpu', env = process.env): boolean {
  if (env.LLAMA_SERVER_BIN) {
    return fs.existsSync(env.LLAMA_SERVER_BIN);
  }
  const vDir = vendorDir(LLAMA_CPP_BUILD, variant, env);
  const markerFile = path.join(vDir, '.installed');
  const bin = binaryPath(variant, env);
  return fs.existsSync(markerFile) && fs.existsSync(bin);
}

export interface EnsureBinaryOptions {
  variant?: BinaryVariant;
  onProgress?: (p: { phase: 'download' | 'extract'; percent?: number; received?: number; total?: number }) => void;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  execTarFn?: (cmd: string, args: string[]) => Promise<unknown>;
}

export async function ensureLlamaServerBinary(opts?: EnsureBinaryOptions): Promise<string> {
  const env = opts?.env ?? process.env;
  if (env.LLAMA_SERVER_BIN && fs.existsSync(env.LLAMA_SERVER_BIN)) {
    return env.LLAMA_SERVER_BIN;
  }

  const effectiveVariant: BinaryVariant =
    (opts?.variant ?? (env.LLAMACPP_VARIANT as BinaryVariant) ?? 'cpu');

  const key = resolvePlatformKey(process.platform, process.arch, effectiveVariant);
  const assetInfo = ASSET_MAP[key];

  if (!assetInfo) {
    throw new Error(
      `Unsupported platform/architecture for built-in llama.cpp: ${key}. ` +
      `Please install llama-server manually and set LLAMA_SERVER_BIN=/path/to/llama-server`,
    );
  }

  const vDir = vendorDir(LLAMA_CPP_BUILD, effectiveVariant, env);
  ensureDir(vDir);

  if (isInstalled(effectiveVariant, env)) {
    return binaryPath(effectiveVariant, env);
  }

  const archiveName = assetInfo.asset;
  const downloadUrl = `https://github.com/ggml-org/llama.cpp/releases/download/b${LLAMA_CPP_BUILD}/${archiveName}`;
  const archivePath = path.join(vDir, archiveName);

  opts?.onProgress?.({ phase: 'download', percent: 0 });

  await downloadFile({
    url: downloadUrl,
    dest: archivePath,
    sha256: assetInfo.sha256,
    signal: opts?.signal,
    fetchFn: opts?.fetchFn,
    onProgress: (p) => {
      opts?.onProgress?.({
        phase: 'download',
        percent: p.percent,
        received: p.received,
        total: p.total,
      });
    },
  });

  opts?.onProgress?.({ phase: 'extract', percent: 50 });

  // System tar extraction (bsdtar bundled on Windows 10 1809+ handles zip as well)
  const tarArgs = assetInfo.isZip
    ? ['-xf', archivePath, '-C', vDir]
    : ['-xzf', archivePath, '-C', vDir];

  try {
    if (opts?.execTarFn) {
      await opts.execTarFn('tar', tarArgs);
    } else {
      await execFileAsync('tar', tarArgs);
    }
  } catch (err) {
    throw new Error(
      `Failed to extract llama.cpp archive using system tar: ${err instanceof Error ? err.message : String(err)}. ` +
      `Please ensure 'tar' is installed on PATH or set LLAMA_SERVER_BIN.`,
    );
  } finally {
    // Delete archive to free 20-300MB
    try {
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    } catch {
      /* ignore */
    }
  }

  // Chmod binary and sibling dynamic libraries (.so, .dylib, .dll)
  const bin = binaryPath(effectiveVariant, env);
  if (!fs.existsSync(bin)) {
    throw new Error(`Extracted archive did not contain expected binary at: ${bin}`);
  }

  try {
    fs.chmodSync(bin, 0o755);
    const binDir = path.dirname(bin);
    const files = fs.readdirSync(binDir);
    for (const f of files) {
      if (f.endsWith('.so') || f.endsWith('.dylib') || f.includes('.so.')) {
        try {
          fs.chmodSync(path.join(binDir, f), 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Write .installed marker only on full success
  fs.writeFileSync(path.join(vDir, '.installed'), `b${LLAMA_CPP_BUILD}-${effectiveVariant}\n`);
  opts?.onProgress?.({ phase: 'extract', percent: 100 });

  return bin;
}
