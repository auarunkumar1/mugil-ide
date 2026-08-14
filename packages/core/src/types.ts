/** Shared types across the Mugil IDE engine. */

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ModelTier = 'cheap' | 'standard' | 'smart';

/** Cost figures are USD per 1M tokens, used for routing and budget decisions. */
export interface ModelSpec {
  id: string;
  tier: ModelTier;
  costPerMTokIn: number;
  costPerMTokOut: number;
  contextWindow: number;
}

export interface CompletionResult {
  provider: string;
  model: string;
  content: string;
  usage: Usage;
  finishReason?: string;
  /** True when the request was served by the offline mock. */
  mock?: boolean;
}

export interface HandoffOptions {
  messages?: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  preferredModel?: string;
  /** Ordered list of model ids to try after the preferred/routed model fails. */
  fallbackChain?: string[];
}

export interface StrategyResult {
  text: string;
  changed: boolean;
  removed?: string[];
}

export interface RefineResult {
  original: string;
  refined: string;
  originalTokens: number;
  refinedTokens: number;
  savingsPct: number;
  appliedStrategies: string[];
}

export type CacheHitKind = 'exact' | 'semantic' | 'partial';

export interface CacheLookupResult {
  entry?: CacheEntry;
  kind?: CacheHitKind;
  /** For partial hits: the portion of the prompt not covered by the cached entry. */
  delta?: string;
}

export interface CacheEntry {
  key: string;
  prompt: string;
  response: string;
  model: string;
  createdAt: number;
  expiresAt: number;
  usage?: Usage;
  /** Feature vector used for semantic lookup; optional for non-semantic stores. */
  embedding?: number[];
}

export interface AskResult {
  response: string;
  model: string;
  provider: string;
  mock: boolean;
  usage: Usage;
  refine: RefineResult;
  cache: {
    hit: boolean;
    kind?: CacheHitKind;
  };
}

/** Live progress events emitted by the pipeline (consumed by the WebView). */
export type PipelineEvent =
  | { type: 'stage'; stage: 'signature' | 'refine' | 'cache' | 'handoff' | 'store' }
  | { type: 'refined'; refine: RefineResult }
  | { type: 'cache'; hit: boolean; kind?: CacheHitKind }
  | { type: 'handoff'; attempts: string[]; model: string; mock?: boolean }
  | { type: 'done'; usage: Usage };

