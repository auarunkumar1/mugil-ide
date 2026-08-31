import type { AppConfig } from './config.js';
import { SmartCache } from './modules/smart-cache/index.js';
import { createCacheBackend } from './modules/smart-cache/backends.js';
import { createEmbeddingProvider } from './modules/smart-cache/embeddings.js';
import { OpenRouterClient } from './modules/handoff/openRouter.js';
import { OpenAiClient } from './modules/handoff/openAi.js';
import { AnthropicClient } from './modules/handoff/anthropic.js';
import { VercelClient } from './modules/handoff/vercel.js';
import { CloudflareClient } from './modules/handoff/cloudflare.js';
import { TogetherClient } from './modules/handoff/together.js';
import { OpenCodeClient } from './modules/handoff/openCode.js';
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

// Tool Loop (agentic function calling)
export { ToolLoop, ToolError, parseToolArguments } from './modules/tool-loop/index.js';
export type {
  ToolRegistry,
  ToolExecutor,
  ToolLoopOptions,
  ToolLoopRunOptions,
  ToolLoopResult,
} from './modules/tool-loop/index.js';
export {
  createWorkspaceTools,
  WORKSPACE_TOOL_DEFINITIONS,
} from './modules/tools/workspaceTools.js';
export type { WorkspaceToolsOptions } from './modules/tools/workspaceTools.js';

// Post-edit diagnostics (tsc --noEmit fed back to the model)
export {
  runDiagnostics,
  findNearestTsconfig,
  diagnosticsEnabledFromEnv,
} from './modules/tools/diagnostics.js';
export type { DiagnosticsOptions, DiagnosticsResult } from './modules/tools/diagnostics.js';

// Tool permissions (allow / ask / deny) + environment context injection
export {
  defaultPolicyForMode,
  resolveToolPermission,
  createPermissionCheck,
  applyPermissionOverrides,
  patternToRegExp,
  READ_TOOLS,
  WRITE_TOOLS,
  EXEC_TOOLS,
} from './modules/tools/permissions.js';
export type {
  ToolPermissionAction,
  PermissionPolicy,
  BashRule,
  PermissionCheck,
} from './modules/tools/permissions.js';
export {
  buildEnvironmentContext,
  findProjectContextFiles,
  PROJECT_CONTEXT_FILES,
} from './modules/tools/context.js';
export type { ProjectContextFile } from './modules/tools/context.js';

// Skills harness (Claude Code style SKILL.md discovery + lazy loading)
export {
  discoverSkills,
  loadSkill,
  skillsContextBlock,
  parseSkillFrontmatter,
  SKILL_DIRS,
} from './modules/skills/index.js';
export type { SkillInfo } from './modules/skills/index.js';

// Token-aware conversation history trimming
export { budgetConversationHistory, renderConversationForSummary } from './history.js';
export type { ConversationTurn, HistoryBudgetOptions, HistoryBudgetResult } from './history.js';

// TUI session persistence (save / restore / clear / named sessions)
export {
  sessionFilePath,
  removeLegacySessionFile,
  namedSessionPath,
  listSessions,
  clearNamedSession,
  saveSession,
  loadSession,
  loadSessionFile,
  clearSession,
} from './modules/sessions.js';
export type { SessionEntry, SessionFile, SessionInfo, SessionStats } from './modules/sessions.js';

// Tool-edit undo/redo snapshots (write_file / edit_file / apply_patch)
export { captureFile, pushEdit, undoLast, redoLast, undoDepth, redoDepth, getRecordedEdits } from './modules/undo.js';
export type { FileState, UndoEdit, UndoResult } from './modules/undo.js';

// LSP client (language-server code intelligence)
export { getLspClient, closeLspClients, LanguageServerClient, formatLspLocations, hoverText, languageIdFor } from './modules/lsp/index.js';
export type { LspClient } from './modules/lsp/index.js';

// Webhook integrations (notify external endpoints about pipeline events)
export { parseWebhookConfigs, fireWebhooks, WEBHOOK_EVENTS } from './modules/webhooks.js';
export type { WebhookConfig, WebhookResult, WebhookEvent } from './modules/webhooks.js';

// MCP client (consume MCP servers as agent tools)
export {
  parseMcpServerConfigs,
  connectMcpServers,
  mcpToolName,
  mcpResultToString,
} from './modules/mcp-client/index.js';
export type { McpServerConfig, McpToolsBundle, McpConnection, McpConnector } from './modules/mcp-client/index.js';

// Auto Handoff (OpenRouter / OpenAI / Anthropic / Vercel / Cloudflare / Together / OpenCode providers)
export { OpenRouterClient, OpenRouterError } from './modules/handoff/openRouter.js';
export type { OpenRouterClientOptions, OpenRouterCompleteOptions } from './modules/handoff/openRouter.js';
export { OpenAiClient } from './modules/handoff/openAi.js';
export type { OpenAiClientOptions } from './modules/handoff/openAi.js';
export { AnthropicClient } from './modules/handoff/anthropic.js';
export type { AnthropicClientOptions } from './modules/handoff/anthropic.js';
export { VercelClient } from './modules/handoff/vercel.js';
export type { VercelClientOptions } from './modules/handoff/vercel.js';
export { CloudflareClient } from './modules/handoff/cloudflare.js';
export type { CloudflareClientOptions } from './modules/handoff/cloudflare.js';
export { TogetherClient } from './modules/handoff/together.js';
export type { TogetherClientOptions } from './modules/handoff/together.js';
export { OpenCodeClient } from './modules/handoff/openCode.js';
export type { OpenCodeClientOptions } from './modules/handoff/openCode.js';
export { ProviderError, mockCompletion } from './modules/handoff/provider.js';
export type { ProviderClient, ProviderCompleteOptions } from './modules/handoff/provider.js';
export { HandoffManager } from './modules/handoff/index.js';
export type { HandoffManagerOptions, HandoffResult } from './modules/handoff/index.js';

// Branding
export { BRAND, BRAND_SLUG, VERSION, BANNER_ART, LOGO_GRID, getBanner, getColoredBanner } from './branding.js';

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
  modelSupportsTools,
  fetchRemoteModels,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_OPENAI_MODELS,
  DEFAULT_ANTHROPIC_MODELS,
  DEFAULT_OLLAMA_MODELS,
  DEFAULT_LMSTUDIO_MODELS,
  DEFAULT_LOCAL_MODELS,
  DEFAULT_VERCEL_MODELS,
  DEFAULT_CLOUDFLARE_MODELS,
  DEFAULT_TOGETHER_MODELS,
  DEFAULT_OPENCODE_MODELS,
} from './config.js';
export { fetchProviderModels } from './modules/handoff/models.js';
export type { FetchModelsOptions } from './modules/handoff/models.js';
export { resolveFileContext, type ResolveContextResult } from './contextResolver.js';
export type { AppConfig, CompletionProvider } from './config.js';
export type {
  Usage,
  ChatMessage,
  ToolDefinition,
  ToolCall,
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
    // Scope cached answers to the workspace directory so the same question in
    // two different projects never serves the other project's answer.
    namespace: process.cwd(),
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
  if (config.provider === 'vercel') {
    return new VercelClient({ apiKey: config.vercelApiKey, baseUrl: config.vercelBaseUrl });
  }
  if (config.provider === 'cloudflare') {
    return new CloudflareClient({
      apiKey: config.cloudflareApiKey,
      accountId: config.cloudflareAccountId,
      baseUrl: config.cloudflareBaseUrl,
    });
  }
  if (config.provider === 'together') {
    return new TogetherClient({ apiKey: config.togetherApiKey, baseUrl: config.togetherBaseUrl });
  }
  if (config.provider === 'opencode') {
    return new OpenCodeClient({ apiKey: config.opencodeApiKey, baseUrl: config.opencodeBaseUrl });
  }
  return new OpenRouterClient({
    apiKey: config.openRouterApiKey,
    baseUrl: config.openRouterBaseUrl,
  });
}
