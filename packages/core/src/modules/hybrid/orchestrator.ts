import * as os from 'node:os';
import * as fs from 'node:fs';
import type { ToolDefinition } from '../../types.js';
import { LlamaServerManager } from '../llamacpp/server.js';
import { tokenizeSecrets } from '../security/secretVault.js';
import { determineActiveBundles, pruneToolSchemas } from './toolPruner.js';
import { discoverDenseContext } from './codeDiscovery.js';
import type { PreflightMode, PreflightResult } from './types.js';

export interface PreflightOptions {
  workspaceDir: string;
  prompt: string;
  allTools: ToolDefinition[];
  env?: NodeJS.ProcessEnv;
  llamaManager?: LlamaServerManager;
  maxCapsuleTokens?: number;
}

/**
 * Checks whether the host system is under heavy memory pressure (Risk 3 Mitigation).
 * Uses Linux MemAvailable where possible, falling back to os.freemem().
 */
export function isLowMemorySystem(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MUGIL_IDE_FORCE_0RAM_PREFLIGHT === '1') return true;

  const totalMem = os.totalmem();
  let freeMem = os.freemem();

  if (process.platform === 'linux') {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const match = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (match && match[1]) {
        freeMem = parseInt(match[1], 10) * 1024;
      }
    } catch {
      /* ignore */
    }
  }

  // 1.5 GB free RAM threshold
  const THRESHOLD = 1.5 * 1024 * 1024 * 1024;
  if (totalMem <= 8 * 1024 * 1024 * 1024 && freeMem < THRESHOLD) {
    return true;
  }
  return freeMem < THRESHOLD;
}

/**
 * Executes hybrid pre-flight orchestration.
 * In low-RAM conditions or when local server is not running, seamlessly engages
 * 0-RAM Algorithmic Pre-Flight Mode.
 */
export async function executePreflight(opts: PreflightOptions): Promise<PreflightResult> {
  const env = opts.env ?? process.env;
  const llama = opts.llamaManager ?? LlamaServerManager.instance();
  const lowMem = isLowMemorySystem(env);

  let mode: PreflightMode = 'algorithmic-0ram';
  if (!lowMem && llama.isRunning()) {
    mode = 'slm-neural';
  }

  // 1. Deterministic CodeGraph discovery
  const { capsule, confidence } = await discoverDenseContext(
    opts.workspaceDir,
    opts.prompt,
    { maxTokens: opts.maxCapsuleTokens ?? 1200 },
  );

  // 2. Secret Redaction on discovered context snippet
  const safeSnippet = tokenizeSecrets(capsule.contextSnippet);
  capsule.contextSnippet = safeSnippet;

  // 3. Dynamic rule-based tool pruning
  const activeBundles = determineActiveBundles(opts.prompt, confidence);
  const pruneResult = pruneToolSchemas(opts.allTools, activeBundles);

  capsule.estimatedSavings.toolPruning = pruneResult.prunedTokens;

  return {
    mode,
    capsule,
    activeBundles,
    prunedToolTokens: pruneResult.prunedTokens,
  };
}
