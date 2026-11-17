import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface HardwareProfile {
  platform: NodeJS.Platform;
  arch: string;
  totalRamGb: number;
  availableRamGb: number;
  cpuCores: number;
  gpu: 'metal' | 'cuda' | 'cpu';
  vramGb?: number;
}

export type HardwareTier = 'tier1_workstation' | 'tier2_balanced' | 'tier3_constrained';
export type RecommendedTopology = 'local-only' | 'hybrid-orchestrated' | 'cloud-only';

export interface HardwareEvaluation {
  profile: HardwareProfile;
  tier: HardwareTier;
  recommendedTopology: RecommendedTopology;
  recommendedLocalModelId: string;
  explanation: string;
}

/** Round down to 1 decimal place to avoid rounding up (e.g. 7.9 GB box must not appear as 8.0 GB). */
function roundDown1(val: number): number {
  return Math.floor(val * 10) / 10;
}

export async function probeHardware(overrides?: Partial<HardwareProfile>): Promise<HardwareProfile> {
  const platform = overrides?.platform ?? process.platform;
  const arch = overrides?.arch ?? process.arch;
  const totalRamGb = overrides?.totalRamGb ?? roundDown1(os.totalmem() / (1024 * 1024 * 1024));
  const availableRamGb =
    overrides?.availableRamGb ??
    roundDown1(
      Math.min(
        os.freemem() / (1024 * 1024 * 1024),
        totalRamGb * 0.6,
      ),
    );
  const cpuCores = overrides?.cpuCores ?? os.cpus().length;

  if (overrides?.gpu) {
    return {
      platform,
      arch,
      totalRamGb,
      availableRamGb,
      cpuCores,
      gpu: overrides.gpu,
      vramGb: overrides.vramGb,
    };
  }

  // Apple Silicon detection: Darwin arm64 natively uses Metal unified memory
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      platform,
      arch,
      totalRamGb,
      availableRamGb,
      cpuCores,
      gpu: 'metal',
      vramGb: totalRamGb, // Apple Silicon unified memory
    };
  }

  // Attempt nvidia-smi probe on PATH (Linux & Windows)
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
      { timeout: 1500 },
    );
    const parsedMb = parseFloat(stdout.trim().split('\n')[0] || '');
    if (Number.isFinite(parsedMb) && parsedMb > 0) {
      const vramGb = roundDown1(parsedMb / 1024);
      return {
        platform,
        arch,
        totalRamGb,
        availableRamGb,
        cpuCores,
        gpu: 'cuda',
        vramGb,
      };
    }
  } catch {
    // Missing binary, permission issue, or timeout -> cleanly degrade to cpu
  }

  return {
    platform,
    arch,
    totalRamGb,
    availableRamGb,
    cpuCores,
    gpu: 'cpu',
  };
}

export function evaluateHardware(profile: HardwareProfile): HardwareEvaluation {
  const isAppleSilicon = profile.platform === 'darwin' && profile.arch === 'arm64';
  const vram = profile.vramGb ?? 0;
  const ram = profile.totalRamGb;

  // Tier 1: High-Performance Workstation (>= 16GB VRAM or Apple Silicon >= 32GB Unified)
  if (vram >= 16 || (isAppleSilicon && ram >= 32)) {
    return {
      profile,
      tier: 'tier1_workstation',
      recommendedTopology: 'local-only',
      recommendedLocalModelId: 'qwen3-coder-30b-a3b-q4km',
      explanation: 'High-performance GPU detected. Full local execution (30B MoE) supported with zero cloud token cost.',
    };
  }

  // Tier 2: Mid-Range Workstation / Balanced Laptop (6GB-15GB VRAM or Apple Silicon 16GB)
  if (vram >= 6 || (isAppleSilicon && ram >= 16) || ram >= 24) {
    return {
      profile,
      tier: 'tier2_balanced',
      recommendedTopology: 'hybrid-orchestrated',
      recommendedLocalModelId: 'qwen2.5-coder-7b-q4km',
      explanation: 'Balanced hardware detected. Hybrid mode recommended (7B local discovery + Cloud master coder) for optimal speed and quality.',
    };
  }

  // Tier 3: Resource-Constrained Laptop (Integrated GPU, CPU-only, <= 12GB RAM)
  return {
    profile,
    tier: 'tier3_constrained',
    recommendedTopology: 'hybrid-orchestrated',
    recommendedLocalModelId: 'qwen2.5-coder-1.5b-q4km',
    explanation: 'Laptop hardware detected. Lightweight 1.5B local model will handle discovery and tool pruning, while cloud model writes code.',
  };
}
