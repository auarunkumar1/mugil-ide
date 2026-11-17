export type ToolBundleName =
  | 'CORE_EDITING'
  | 'TERMINAL'
  | 'EXPLORATION'
  | 'MEDIA'
  | 'EXTENSIONS';

export interface DiscoveredSymbol {
  name: string;
  file: string;
  kind?: string;
  line?: number;
  signature?: string;
}

export interface DenseContextCapsule {
  taskSummary: string;
  discoveredSymbols: DiscoveredSymbol[];
  contextSnippet: string;
  openDoorContract: string;
  suggestedTools: string[];
  estimatedSavings: {
    toolPruning: number;
    hybridRecon: number;
  };
}

export type PreflightMode = 'slm-neural' | 'algorithmic-0ram';

export interface PreflightResult {
  mode: PreflightMode;
  capsule: DenseContextCapsule;
  activeBundles: ToolBundleName[];
  prunedToolTokens: number;
}
