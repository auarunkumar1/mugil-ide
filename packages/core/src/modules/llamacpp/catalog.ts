import type { HardwareProfile } from './hardware.js';

export interface CatalogModel {
  id: string;
  label: string;
  hfRepo: string;
  hfFile: string;
  sizeBytes: number;
  minRamGb: number;
  quant: string;
  paramsB: number;
  quality: number; // 1..10, tie-break ranking
  minLlamaBuild: number;
  license: string;
  contextWindow: number;
  supportsTools: boolean;
  sha256?: string;
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'qwen2.5-coder-1.5b-q4km',
    label: 'Qwen2.5 Coder 1.5B (Q4_K_M)',
    hfRepo: 'unsloth/Qwen2.5-Coder-1.5B-Instruct-GGUF',
    hfFile: 'Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf',
    sizeBytes: 986048032,
    minRamGb: 3,
    quant: 'Q4_K_M',
    paramsB: 1.5,
    quality: 6,
    minLlamaBuild: 4000,
    license: 'apache-2.0',
    contextWindow: 32768,
    supportsTools: true,
    sha256: '5ecd6f45e137154099741291848db7415b5effa1ae69228f20dacea31dbf5ce4',
  },
  {
    id: 'qwen2.5-coder-3b-q4km',
    label: 'Qwen2.5 Coder 3B (Q4_K_M)',
    hfRepo: 'unsloth/Qwen2.5-Coder-3B-Instruct-GGUF',
    hfFile: 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 1929902496,
    minRamGb: 4,
    quant: 'Q4_K_M',
    paramsB: 3,
    quality: 7,
    minLlamaBuild: 4000,
    license: 'apache-2.0',
    contextWindow: 32768,
    supportsTools: true,
    sha256: '32f0014400ca1c1f81e7fb5befa9b9af476ba967dcbf92bad27409228c57c5b4',
  },
  {
    id: 'qwen2.5-coder-0.5b-q4km',
    label: 'Qwen2.5 Coder 0.5B (Q4_K_M)',
    hfRepo: 'unsloth/Qwen2.5-Coder-0.5B-Instruct-GGUF',
    hfFile: 'Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf',
    sizeBytes: 397807456,
    minRamGb: 2,
    quant: 'Q4_K_M',
    paramsB: 0.5,
    quality: 4,
    minLlamaBuild: 4000,
    license: 'apache-2.0',
    contextWindow: 32768,
    supportsTools: true,
    sha256: '8c3d7a77d612727c35cc6f94ee9316e00ad53ba1cb41414e6b26b96be6a5338a',
  },
  {
    id: 'deepseek-r1-distill-qwen-1.5b-q4km',
    label: 'DeepSeek R1 Distill Qwen 1.5B (Q4_K_M)',
    hfRepo: 'unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    hfFile: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
    sizeBytes: 1117321312,
    minRamGb: 3,
    quant: 'Q4_K_M',
    paramsB: 1.5,
    quality: 5,
    minLlamaBuild: 4000,
    license: 'mit',
    contextWindow: 32768,
    supportsTools: true,
    sha256: 'f3bdf9cf31dee4b57ae4e455a1cb0d01b5c2c1b50d72d3112141c195506c2840',
  },
  {
    id: 'qwen3-4b-instruct-2507-q4km',
    label: 'Qwen3 4B Instruct 2507 (Q4_K_M)',
    hfRepo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF',
    hfFile: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    sizeBytes: 2497281120,
    minRamGb: 6,
    quant: 'Q4_K_M',
    paramsB: 4,
    quality: 6,
    minLlamaBuild: 4000,
    license: 'apache-2.0',
    contextWindow: 32768,
    supportsTools: true,
    sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
  },
  {
    id: 'qwen2.5-coder-7b-q4km',
    label: 'Qwen2.5 Coder 7B (Q4_K_M)',
    hfRepo: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF',
    hfFile: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    sizeBytes: 4683073504,
    minRamGb: 8,
    quant: 'Q4_K_M',
    paramsB: 7,
    quality: 7,
    minLlamaBuild: 4000,
    license: 'apache-2.0',
    contextWindow: 32768,
    supportsTools: true,
    sha256: '9a961bb225cb2b9fd84b2297df0d53089895c049d7d9dc5f5f8aebbcd3247872',
  },
  {
    id: 'qwen2.5-coder-7b-q5km',
    label: 'Qwen2.5 Coder 7B (Q5_K_M)',
    hfRepo: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF',
    hfFile: 'Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf',
    sizeBytes: 5444831200,
    minRamGb: 10,
    quant: 'Q5_K_M',
    paramsB: 7,
    quality: 8,
    minLlamaBuild: 4000,
    license: 'apache-2.0',
    contextWindow: 32768,
    supportsTools: true,
    sha256: '8a025f8bae85617ac95209d9211cbfb2a7142b129a201fa2c2c140ed34661113',
  },
  {
    id: 'gemma3-12b-q4km',
    label: 'Gemma 3 12B (Q4_K_M)',
    hfRepo: 'ggml-org/gemma-3-12b-it-GGUF',
    hfFile: 'gemma-3-12b-it-Q4_K_M.gguf',
    sizeBytes: 7300574976,
    minRamGb: 12,
    quant: 'Q4_K_M',
    paramsB: 12,
    quality: 8,
    minLlamaBuild: 4000,
    license: 'gemma',
    contextWindow: 8192,
    supportsTools: false,
    sha256: '7bb69bff3f48a7b642355d64a90e481182a7794707b3133890646b1efa778ff5',
  },
  {
    id: 'qwen3-coder-30b-a3b-q4km',
    label: 'Qwen3 Coder 30B-A3B MoE (Q4_K_M)',
    hfRepo: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
    hfFile: 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 18556689568,
    minRamGb: 24,
    quant: 'Q4_K_M',
    paramsB: 30,
    quality: 10,
    minLlamaBuild: 4000,
    license: 'apache-2.0',
    contextWindow: 32768,
    supportsTools: true,
    sha256: 'fadc3e5f8d42bf7e894a785b05082e47daee4df26680389817e2093056f088ad',
  },
];

/** Formats canonical direct download URL from Hugging Face resolve endpoint. */
export function downloadUrl(m: CatalogModel): string {
  return `https://huggingface.co/${m.hfRepo}/resolve/main/${m.hfFile}?download=true`;
}

/** Looks up a catalog model by stable id. */
export function catalogEntry(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/**
 * Recommends models that fit the user's hardware.
 * Filters by minRamGb <= availableRamGb, sorts by quality desc,
 * and guarantees at least the single smallest model is returned so low-spec
 * machines never receive an empty list.
 */
export function recommendModels(
  profile: HardwareProfile,
  opts?: { limit?: number },
): CatalogModel[] {
  const fitting = MODEL_CATALOG.filter((m) => m.minRamGb <= profile.availableRamGb);
  fitting.sort((a, b) => b.quality - a.quality);

  // Guarantee at least the smallest model is always present for low-RAM machines
  if (fitting.length === 0 && MODEL_CATALOG.length > 0) {
    const smallest = [...MODEL_CATALOG].sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
    if (smallest) fitting.push(smallest);
  }

  const limit = opts?.limit ?? 3;
  return fitting.slice(0, limit);
}
