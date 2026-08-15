import type { AppConfig } from './config.js';
import { SmartCache } from './modules/smart-cache/index.js';
import { createCacheBackend } from './modules/smart-cache/backends.js';
import { createEmbeddingProvider } from './modules/smart-cache/embeddings.js';
import { OpenRouterClient } from './modules/handoff/openRouter.js';
import { OpenAiClient } from './modules/handoff/openAi.js';
import { AnthropicClient } from './modules/handoff/anthropic.js';
import type { ProviderClient } from './modules/handoff/provider.js';
import { HandoffManager } from './modules/handoff/index.js';
import { Pipeline } from './pipeline.js';
import { installOverrideReader } from './modules/overridesNode.js';

// Node callers get filesystem-backed rule overrides; browsers (which never
// import this barrel) keep the bundled defaults via the browser entry.
installOverrideReader();

// --- Credited modules -------------------------------------------------------

// Caveman (inspired by JuliusBrussee/caveman)
export { cavemanStrategy } from './modules/caveman/index.js';

// RTK — Reduced Token Kernel (inspired by rtk-ai/rtk)
export { rtkStrategy, compressCommandOutput } from './modules/rtk/index.js';
export type { CompressOutputOptions } from './modules/rtk/index.js';

// Ponytail (inspired by DietrichGebert/ponytail)
export { ponytailInstruction, ponytailOutputBudget } from './modules/ponytail/index.js';
export type { PonytailOptions } from './modules/ponytail/index.js';

// Signature Remover (Anthropic / OpenAI formats; community de-AI tooling)
export { stripSignatures, stripCodeSignatures } from './modules/signature-remover/index.js';
export type { ProviderName, StripOptions } from './modules/signature-remover/index.js';

// Watermark Remover (inspired by guillaumemeyer/watermarks-remover)
export { stripWatermarks } from './modules/watermark-remover/index.js';
export type { StripWatermarkOptions, WatermarkProvider } from './modules/watermark-remover/index.js';

// Codegraph (inspired by colbymchenry/codegraph)
export {
  buildCodeGraph,
  collectSourceFiles,
  parseCodeFile,
  queryCodeGraph,
  languageFor,
} from './modules/codegraph/index.js';
export type {
  CodeGraph,
  CodeFile,
  CodeSymbol,
  ImportEdge,
  CallEdge,
  QueryResult,
  BuildCodeGraphOptions,
  CodeLanguage,
} from './modules/codegraph/index.js';

// Smart Cache (exact / partial / semantic; Redis backend)
export { SmartCache } from './modules/smart-cache/index.js';
export type { SmartCacheOptions } from './modules/smart-cache/index.js';
export {
  MemoryBackend,
  RedisBackend,
  FileBackend,
  createCacheBackend,
  exactKey,
  normalizePrompt,
} from './modules/smart-cache/backends.js';
export type { CacheBackend } from './modules/smart-cache/backends.js';
export {
  LexicalEmbedding,
  RemoteEmbedding,
  createEmbeddingProvider,
  cosineSimilarity,
} from './modules/smart-cache/embeddings.js';
export type { EmbeddingProvider } from './modules/smart-cache/embeddings.js';

// Auto Handoff (OpenRouter / OpenAI / Anthropic providers)
export { OpenRouterClient, OpenRouterError } from './modules/handoff/openRouter.js';
export type { OpenRouterClientOptions, OpenRouterCompleteOptions } from './modules/handoff/openRouter.js';
export { OpenAiClient } from './modules/handoff/openAi.js';
export type { OpenAiClientOptions } from './modules/handoff/openAi.js';
export { AnthropicClient } from './modules/handoff/anthropic.js';
export type { AnthropicClientOptions } from './modules/handoff/anthropic.js';
export { ProviderError, mockCompletion } from './modules/handoff/provider.js';
export type { ProviderClient, ProviderCompleteOptions } from './modules/handoff/provider.js';
export { HandoffManager } from './modules/handoff/index.js';
export type { HandoffManagerOptions, HandoffResult } from './modules/handoff/index.js';

// Branding
export { BRAND, BRAND_SLUG, VERSION, BANNER_ART, LOGO_GRID, getBanner } from './branding.js';

// --- Composition layer ------------------------------------------------------

export { refinePrompt, truncateToBudget } from './refine.js';
export type { RefineOptions } from './refine.js';
export { getTokenizer, countTokens } from './token/tokenizer.js';
export type { Tokenizer } from './token/tokenizer.js';

// Pipeline
export { Pipeline } from './pipeline.js';
export type { PipelineOptions, AskOptions } from './pipeline.js';

// Auto Update Manager + rules override store
export { UpdateManager } from './update/updateManager.js';
export type {
  UpdateManagerOptions,
  CheckResult,
  ModuleUpdateInfo,
  NpmUpdateInfo,
  RemoteRegistry,
} from './update/updateManager.js';
// The fs-backed override reader must be installed before any module loads
// its rules, so Node callers get override support (browsers simply skip it).
export { installOverrideReader } from './modules/overridesNode.js';
export {
  loadRulesSync,
  clearRulesCache,
  currentRevision,
  setOverrideReader,
} from './modules/overrides.js';
export { overrideDir, readOverrideSync, writeOverrideSync } from './modules/overridesNode.js';

// User env file (API-key storage)
export {
  userEnvPath,
  parseEnvFile,
  readUserEnv,
  serializeEnvFile,
  writeUserEnv,
  deleteUserEnvKeys,
} from './env.js';

// Config + types
export {
  loadConfig,
  isLocalUrl,
  modelSupportsThinking,
  fetchRemoteModels,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_OPENAI_MODELS,
  DEFAULT_ANTHROPIC_MODELS,
  DEFAULT_OLLAMA_MODELS,
  DEFAULT_LMSTUDIO_MODELS,
  DEFAULT_LOCAL_MODELS,
} from './config.js';
export { fetchProviderModels } from './modules/handoff/models.js';
export type { FetchModelsOptions } from './modules/handoff/models.js';
export { resolveFileContext, type ResolveContextResult } from './contextResolver.js';
export type { AppConfig, CompletionProvider } from './config.js';
export type {
  Usage,
  ChatMessage,
  ModelSpec,
  ModelTier,
  ThinkingLevel,
  CompletionResult,
  HandoffOptions,
  RefineResult,
  StrategyResult,
  CacheHitKind,
  CacheLookupResult,
  CacheEntry,
  AskResult,
  PipelineEvent,
} from './types.js';

/** Builds a fully-wired engine from the environment. */
export function createEngine(config: AppConfig) {
  let currentConfig = config;
  const cacheBackend = createCacheBackend({
    redisUrl: currentConfig.redisUrl,
    redisClusterUrls: currentConfig.redisClusterUrls,
    cacheDir: currentConfig.cacheDir,
  });
  const embedding = createEmbeddingProvider(currentConfig.embedding);
  const cache = new SmartCache({
    backend: cacheBackend,
    ttlSeconds: currentConfig.cacheTtlSeconds,
    embedding,
  });
  let client = createClient(currentConfig);
  const handoff = new HandoffManager({ client, models: currentConfig.models });
  const pipeline = new Pipeline({
    cache,
    handoff,
    tokenBudget: currentConfig.tokenBudget,
  });

  const engine = {
    cache,
    handoff,
    pipeline,
    get client() {
      return client;
    },
    get config() {
      return currentConfig;
    },
    backend: cacheBackend,
    reconfigure(newConfig: AppConfig) {
      currentConfig = newConfig;
      client = createClient(newConfig);
      handoff.setClient(client);
      handoff.setModels(newConfig.models);
      pipeline.tokenBudget = newConfig.tokenBudget;
      return engine;
    },
  };

  return engine;
}

export type Engine = ReturnType<typeof createEngine>;

/** Picks the completion client for the configured provider. */
function createClient(config: AppConfig): ProviderClient {
  if (config.provider === 'ollama') {
    return new OpenAiClient({ apiKey: 'ollama', baseUrl: config.ollamaBaseUrl });
  }
  if (config.provider === 'lmstudio') {
    return new OpenAiClient({ apiKey: 'lm-studio', baseUrl: config.lmstudioBaseUrl });
  }
  if (config.provider === 'local') {
    return new OpenAiClient({ apiKey: 'local', baseUrl: config.localBaseUrl });
  }
  if (config.provider === 'openai') {
    return new OpenAiClient({ apiKey: config.openaiApiKey, baseUrl: config.openaiBaseUrl });
  }
  if (config.provider === 'anthropic') {
    return new AnthropicClient({ apiKey: config.anthropicApiKey, baseUrl: config.anthropicBaseUrl });
  }
  return new OpenRouterClient({
    apiKey: config.openRouterApiKey,
    baseUrl: config.openRouterBaseUrl,
  });
}
