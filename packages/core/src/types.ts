/** Shared types across the Mugil IDE engine. */

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object for the tool's parameters (provider-agnostic). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string of the arguments, exactly as sent by the model. */
  arguments: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant messages that requested tools (content may be ''). */
  toolCalls?: ToolCall[];
  /** Tool messages: the id of the ToolCall this is the result of. */
  toolCallId?: string;
}

export type ModelTier = 'cheap' | 'standard' | 'smart';
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

/** Cost figures are USD per 1M tokens, used for routing and budget decisions. */
export interface ModelSpec {
  id: string;
  tier: ModelTier;
  costPerMTokIn: number;
  costPerMTokOut: number;
  contextWindow: number;
  supportsThinking?: boolean;
  /** Whether the model can call tools. Populated from catalog data when available. */
  supportsTools?: boolean;
}

export interface CompletionResult {
  provider: string;
  model: string;
  content: string;
  usage: Usage;
  finishReason?: string;
  /** Tool calls the model requested; absent when it answered directly. */
  toolCalls?: ToolCall[];
  /** True when the request was served by the offline mock. */
  mock?: boolean;
  /** Reasoning/thinking output from reasoning-capable models, if any. */
  thinking?: string;
}

export interface HandoffOptions {
  messages?: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  preferredModel?: string;
  /** Ordered list of model ids to try after the preferred/routed model fails. */
  fallbackChain?: string[];
  /** Tools the model may call. Omit for plain completions. */
  tools?: ToolDefinition[];
  /** Reasoning/thinking level requested ('off' | 'low' | 'medium' | 'high'). */
  thinkingLevel?: ThinkingLevel;
  /** Explicit token budget for thinking (e.g. Anthropic budget_tokens). */
  thinkingBudgetTokens?: number;
  /** Cancels the request (user pressed Ctrl-C). */
  signal?: AbortSignal;
  /** Hard wall-clock cap for the provider request. */
  timeoutMs?: number;
  /**
   * Stream tokens as they arrive. Default true. Set false (or
   * MUGIL_IDE_NO_STREAM=1) to force a single buffered completion. Declared
   * here rather than on the callers so every `{ ...options }` spread carries
   * the request-scoped choice down to the provider request.
   */
  stream?: boolean;
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
  /**
   * True when the `truncate` strategy actually cut prompt content. Callers must
   * surface this: the model only saw the kept prefix, so it is answering a
   * different (shorter) question than the one that was asked.
   */
  truncated: boolean;
  /** Tokens dropped by truncation (0 when nothing was cut). */
  truncatedTokens: number;
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
  /**
   * True when the entry was produced by the offline mock client. The pipeline
   * discards such entries when a live provider is active — the [mock] content
   * marker alone is ambiguous, so the flag is authoritative.
   */
  mock?: boolean;
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
  /** Reasoning/thinking output from the model, if any (not cached). */
  thinking?: string;
  /** Number of tool calls executed while answering (0 for plain asks). */
  toolCalls: number;
  /**
   * Provider-reported stop reason (`length`, `stop`, `tool_calls`, ...).
   * `length` means the answer was cut off at max_tokens — callers should say so
   * rather than presenting a partial reply as complete.
   */
  finishReason?: string;
  /** True when the provider stopped because it hit the output-token cap. */
  truncated: boolean;
}

/** Live progress events emitted by the pipeline (consumed by the WebView). */
export type PipelineEvent =
  | { type: 'stage'; stage: 'signature' | 'refine' | 'cache' | 'handoff' | 'store' }
  | { type: 'refined'; refine: RefineResult }
  | { type: 'cache'; hit: boolean; kind?: CacheHitKind }
  | { type: 'handoff'; attempts: string[]; model: string; mock?: boolean }
  | { type: 'tool'; name: string; args?: string; index?: number }
  | { type: 'tool-result'; name: string; index?: number; ok: boolean; result: string }
  | { type: 'truncated'; finishReason: string; maxTokens: number }
  | { type: 'done'; usage: Usage }
  /**
   * A live text fragment as it arrives. Provisional: a completion that streams
   * text and THEN requests tool calls makes the consumer discard what it
   * rendered. Consumers must treat this as "display progress", not as the
   * final answer — `AskResult.response` is the authoritative text.
   *
   * `streamed` is the provenance flag. `true` ONLY for fragments that arrived
   * incrementally over SSE; `false` for the single delta the buffered fallback
   * replays when a provider has no `stream()`, or when `stream: false` /
   * `MUGIL_IDE_NO_STREAM=1` forces one buffered completion. Without it a
   * renderer cannot tell "text arriving progressively" from "the whole answer
   * replayed as one delta", so the buffered replay would be rendered with
   * streaming presentation. The replay is always exactly ONE delta.
   */
  | { type: 'delta'; text: string; streamed: boolean };

