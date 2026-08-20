import * as os from 'node:os';
import * as path from 'node:path';
import type { ModelSpec } from './types.js';
import { readUserEnv } from './env.js';

/** Checks whether a model ID supports extended thinking/reasoning. */
export function modelSupportsThinking(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes('3.7-sonnet') ||
    lower.includes('3-7-sonnet') ||
    lower.includes('deepseek-r1') ||
    lower.includes('deepseek/r1') ||
    lower.includes('o1') ||
    lower.includes('o3') ||
    lower.includes('thinking') ||
    lower.includes('reasoning') ||
    lower.includes('qwq')
  );
}

/**
 * Whether a model can call tools. Conservative default true — every current
 * provider's models support function calling; per-model catalog data (e.g.
 * OpenRouter `supported_parameters`) refines this when available.
 */
export function modelSupportsTools(_id: string): boolean {
  return true;
}

/** Default OpenRouter model ladder used when OPENROUTER_MODELS is not set. */
export const DEFAULT_OPENROUTER_MODELS: ModelSpec[] = [
  { id: 'openrouter/auto', tier: 'cheap', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 },
  {
    id: 'anthropic/claude-3.7-sonnet',
    tier: 'smart',
    costPerMTokIn: 3,
    costPerMTokOut: 15,
    contextWindow: 200000,
    supportsThinking: true,
  },
  {
    id: 'anthropic/claude-3.7-sonnet:thinking',
    tier: 'smart',
    costPerMTokIn: 3,
    costPerMTokOut: 15,
    contextWindow: 200000,
    supportsThinking: true,
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    tier: 'smart',
    costPerMTokIn: 3,
    costPerMTokOut: 15,
    contextWindow: 200000,
  },
  {
    id: 'deepseek/deepseek-r1',
    tier: 'smart',
    costPerMTokIn: 0.55,
    costPerMTokOut: 2.19,
    contextWindow: 160000,
    supportsThinking: true,
  },
  {
    id: 'deepseek/deepseek-chat',
    tier: 'cheap',
    costPerMTokIn: 0.14,
    costPerMTokOut: 0.28,
    contextWindow: 64000,
  },
  {
    id: 'openai/gpt-4o',
    tier: 'standard',
    costPerMTokIn: 2.5,
    costPerMTokOut: 10,
    contextWindow: 128000,
  },
  {
    id: 'openai/gpt-4o-mini',
    tier: 'cheap',
    costPerMTokIn: 0.15,
    costPerMTokOut: 0.6,
    contextWindow: 128000,
  },
  {
    id: 'openai/o3-mini',
    tier: 'smart',
    costPerMTokIn: 1.1,
    costPerMTokOut: 4.4,
    contextWindow: 200000,
    supportsThinking: true,
  },
  {
    id: 'google/gemini-2.0-flash-001',
    tier: 'cheap',
    costPerMTokIn: 0.1,
    costPerMTokOut: 0.4,
    contextWindow: 1000000,
  },
  {
    id: 'google/gemini-2.5-pro-preview',
    tier: 'smart',
    costPerMTokIn: 1.25,
    costPerMTokOut: 5,
    contextWindow: 2000000,
    supportsThinking: true,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    tier: 'standard',
    costPerMTokIn: 0.12,
    costPerMTokOut: 0.3,
    contextWindow: 128000,
  },
  {
    id: 'qwen/qwq-32b',
    tier: 'smart',
    costPerMTokIn: 0.15,
    costPerMTokOut: 0.6,
    contextWindow: 128000,
    supportsThinking: true,
  },
  {
    id: 'mistralai/mistral-large-2411',
    tier: 'smart',
    costPerMTokIn: 2,
    costPerMTokOut: 6,
    contextWindow: 128000,
  },
  {
    id: 'mistralai/mistral-small',
    tier: 'cheap',
    costPerMTokIn: 0.2,
    costPerMTokOut: 0.6,
    contextWindow: 32000,
  },
];

/** Default OpenAI ladder used when OPENAI_MODELS is not set. */
export const DEFAULT_OPENAI_MODELS: ModelSpec[] = [
  { id: 'gpt-4o-mini', tier: 'cheap', costPerMTokIn: 0.15, costPerMTokOut: 0.6, contextWindow: 128000 },
  { id: 'gpt-4o', tier: 'standard', costPerMTokIn: 2.5, costPerMTokOut: 10, contextWindow: 128000 },
  { id: 'o3-mini', tier: 'smart', costPerMTokIn: 1.1, costPerMTokOut: 4.4, contextWindow: 200000, supportsThinking: true },
  { id: 'o1', tier: 'smart', costPerMTokIn: 15, costPerMTokOut: 60, contextWindow: 200000, supportsThinking: true },
];

/** Default Anthropic ladder used when ANTHROPIC_MODELS is not set. */
export const DEFAULT_ANTHROPIC_MODELS: ModelSpec[] = [
  { id: 'claude-3-5-haiku', tier: 'cheap', costPerMTokIn: 0.8, costPerMTokOut: 4, contextWindow: 200000 },
  { id: 'claude-3-5-sonnet', tier: 'standard', costPerMTokIn: 3, costPerMTokOut: 15, contextWindow: 200000 },
  { id: 'claude-3-7-sonnet', tier: 'smart', costPerMTokIn: 3, costPerMTokOut: 15, contextWindow: 200000, supportsThinking: true },
];

/** Default Ollama ladder used when OLLAMA_MODELS is not set. */
export const DEFAULT_OLLAMA_MODELS: ModelSpec[] = [
  { id: 'llama3.2', tier: 'cheap', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 },
  { id: 'deepseek-r1:8b', tier: 'smart', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000, supportsThinking: true },
  { id: 'deepseek-r1', tier: 'smart', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000, supportsThinking: true },
  { id: 'qwen2.5-coder', tier: 'smart', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 },
  { id: 'mistral', tier: 'standard', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 32000 },
];

/** Default LM Studio ladder. */
export const DEFAULT_LMSTUDIO_MODELS: ModelSpec[] = [
  { id: 'local-model', tier: 'standard', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 },
  { id: 'deepseek-r1', tier: 'smart', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000, supportsThinking: true },
];

/** Default Local OpenAI endpoint ladder. */
export const DEFAULT_LOCAL_MODELS: ModelSpec[] = [
  { id: 'local-model', tier: 'standard', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 },
  { id: 'deepseek-r1', tier: 'smart', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000, supportsThinking: true },
];

/** Default Vercel AI Gateway ladder. */
export const DEFAULT_VERCEL_MODELS: ModelSpec[] = [
  { id: 'gpt-4o-mini', tier: 'cheap', costPerMTokIn: 0.15, costPerMTokOut: 0.6, contextWindow: 128000 },
  { id: 'gpt-4o', tier: 'standard', costPerMTokIn: 2.5, costPerMTokOut: 10, contextWindow: 128000 },
  { id: 'claude-3-5-sonnet-latest', tier: 'smart', costPerMTokIn: 3, costPerMTokOut: 15, contextWindow: 200000 },
  { id: 'claude-3-7-sonnet-latest', tier: 'smart', costPerMTokIn: 3, costPerMTokOut: 15, contextWindow: 200000, supportsThinking: true },
  { id: 'deepseek-r1', tier: 'smart', costPerMTokIn: 0.55, costPerMTokOut: 2.19, contextWindow: 160000, supportsThinking: true },
];

/** Default Cloudflare Workers AI ladder. */
export const DEFAULT_CLOUDFLARE_MODELS: ModelSpec[] = [
  { id: '@cf/meta/llama-3.3-70b-instruct', tier: 'standard', costPerMTokIn: 0.12, costPerMTokOut: 0.3, contextWindow: 128000 },
  { id: '@cf/meta/llama-3.1-8b-instruct', tier: 'cheap', costPerMTokIn: 0.05, costPerMTokOut: 0.15, contextWindow: 128000 },
  { id: '@cf/meta/llama-3.2-3b-instruct', tier: 'cheap', costPerMTokIn: 0.02, costPerMTokOut: 0.08, contextWindow: 128000 },
  { id: '@cf/qwen/qwq-32b', tier: 'smart', costPerMTokIn: 0.15, costPerMTokOut: 0.6, contextWindow: 128000, supportsThinking: true },
  { id: '@cf/deepseek/deepseek-r1-distill-qwen-32b', tier: 'smart', costPerMTokIn: 0.15, costPerMTokOut: 0.6, contextWindow: 128000, supportsThinking: true },
];

/** Default Together AI ladder. */
export const DEFAULT_TOGETHER_MODELS: ModelSpec[] = [
  { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', tier: 'standard', costPerMTokIn: 0.12, costPerMTokOut: 0.3, contextWindow: 128000 },
  { id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo', tier: 'cheap', costPerMTokIn: 0.05, costPerMTokOut: 0.15, contextWindow: 128000 },
  { id: 'deepseek-ai/DeepSeek-R1', tier: 'smart', costPerMTokIn: 0.55, costPerMTokOut: 2.19, contextWindow: 160000, supportsThinking: true },
  { id: 'Qwen/Qwen3-30B-A3B-Turbo', tier: 'smart', costPerMTokIn: 0.15, costPerMTokOut: 0.6, contextWindow: 128000, supportsThinking: true },
  { id: 'mistralai/Mistral-Small-24B-Instruct-2501', tier: 'cheap', costPerMTokIn: 0.1, costPerMTokOut: 0.3, contextWindow: 32000 },
];

/** Fetches available models from provider API with fallback to static catalog. */
export async function fetchRemoteModels(
  provider: CompletionProvider,
  apiKey?: string,
  baseUrl?: string,
): Promise<ModelSpec[]> {
  try {
    if (provider === 'openrouter') {
      const url = `${baseUrl || 'https://openrouter.ai/api/v1'}/models`;
      const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{
            id: string;
            name?: string;
            context_length?: number;
            pricing?: { prompt?: string; completion?: string };
          }>;
        };
        if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          const list: ModelSpec[] = json.data.map((m) => {
            const costIn = m.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : 0;
            const costOut = m.pricing?.completion ? Number(m.pricing.completion) * 1_000_000 : 0;
            const tier: ModelSpec['tier'] = costOut > 5 ? 'smart' : costOut > 0.5 ? 'standard' : 'cheap';
            return {
              id: m.id,
              tier,
              costPerMTokIn: isNaN(costIn) ? 0 : costIn,
              costPerMTokOut: isNaN(costOut) ? 0 : costOut,
              contextWindow: m.context_length || 128000,
              supportsThinking: modelSupportsThinking(m.id),
            };
          });
          return list;
        }
      }
    }
  } catch {
    // offline or timeout -> return curated list
  }
  if (provider === 'openai') return DEFAULT_OPENAI_MODELS;
  if (provider === 'anthropic') return DEFAULT_ANTHROPIC_MODELS;
  return DEFAULT_OPENROUTER_MODELS;
}

export function isLocalUrl(url?: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('0.0.0.0') ||
    lower.includes('::1')
  );
}

export type CompletionProvider = 'openrouter' | 'openai' | 'anthropic' | 'ollama' | 'lmstudio' | 'local' | 'vercel' | 'cloudflare' | 'together';

export interface AppConfig {
  /** The provider the engine talks to (OpenRouter primary; else OpenAI/Anthropic/Ollama/LM Studio/Local/Vercel/Cloudflare/Together). */
  provider: CompletionProvider;
  openRouterApiKey?: string;
  openRouterBaseUrl: string;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  ollamaBaseUrl: string;
  lmstudioBaseUrl: string;
  localBaseUrl: string;
  vercelApiKey?: string;
  vercelBaseUrl: string;
  cloudflareApiKey?: string;
  cloudflareAccountId?: string;
  cloudflareBaseUrl: string;
  togetherApiKey?: string;
  togetherBaseUrl: string;
  redisUrl?: string;
  redisClusterUrls?: string[];
  cacheDir?: string;
  nodeEnv: string;
  aiDebug: boolean;
  tokenBudget: number;
  cacheTtlSeconds: number;
  models: ModelSpec[];
  embedding: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseModels(value: string | undefined, fallback: ModelSpec[]): ModelSpec[] {
  if (!value) return fallback;
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return fallback;
  const tiers: ModelSpec['tier'][] = ['cheap', 'standard', 'smart'];
  return ids.map((id, i) => ({
    id,
    tier: tiers[i] ?? 'standard',
    costPerMTokIn: 0,
    costPerMTokOut: 0,
    contextWindow: 128000,
    supportsThinking: modelSupportsThinking(id),
  }));
}

/**
 * Loads configuration from the environment with sensible defaults.
 *
 * Resolution order per variable: defaults < user env file
 * (`~/.config/mugil-ide/.env`, see env.ts) < process.env. The user env file
 * is only consulted outside tests (NODE_ENV=test stays hermetic).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const userFile = env.NODE_ENV === 'test' ? {} : readUserEnv(env);
  const cleanEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== '') {
      cleanEnv[k] = v;
    }
  }
  const merged: NodeJS.ProcessEnv = { ...userFile, ...cleanEnv };

  const tokenBudget = Number(merged.TOKEN_BUDGET ?? 10000);
  const cacheTtl = Number(merged.CACHE_TTL ?? 3600);
  // When neither Redis nor a cache dir is configured, persist to the user's
  // home directory so the cache survives across CLI invocations (except in
  // tests, which should stay hermetic).
  const defaultCacheDir =
    merged.NODE_ENV === 'test' ? undefined : path.join(os.homedir(), '.cache', 'mugil-ide');

  const openRouterApiKey = merged.OPENROUTER_API_KEY || undefined;
  const openaiApiKey = merged.OPENAI_API_KEY || undefined;
  const anthropicApiKey = merged.ANTHROPIC_API_KEY || undefined;
  const vercelApiKey = merged.VERCEL_API_KEY || undefined;
  const cloudflareApiKey = merged.CLOUDFLARE_API_KEY || undefined;
  const cloudflareAccountId = merged.CLOUDFLARE_ACCOUNT_ID || undefined;
  const togetherApiKey = merged.TOGETHER_API_KEY || undefined;

  // Provider resolution: OpenRouter is primary; AI_PROVIDER overrides.
  const requested = (merged.AI_PROVIDER ?? '').toLowerCase();
  const provider: CompletionProvider =
    requested === 'ollama'
      ? 'ollama'
      : requested === 'lmstudio'
        ? 'lmstudio'
        : requested === 'local'
          ? 'local'
          : requested === 'openai'
            ? 'openai'
            : requested === 'anthropic'
              ? 'anthropic'
              : requested === 'vercel'
                ? 'vercel'
                : requested === 'cloudflare'
                  ? 'cloudflare'
                  : requested === 'together'
                    ? 'together'
                    : openRouterApiKey
                      ? 'openrouter'
                      : openaiApiKey
                        ? 'openai'
                        : anthropicApiKey
                          ? 'anthropic'
                          : vercelApiKey
                            ? 'vercel'
                            : cloudflareApiKey
                              ? 'cloudflare'
                              : togetherApiKey
                                ? 'together'
                                : 'openrouter';

  const rawModels =
    provider === 'openai'
      ? parseModels(merged.OPENAI_MODELS, DEFAULT_OPENAI_MODELS)
      : provider === 'anthropic'
        ? parseModels(merged.ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODELS)
        : provider === 'ollama'
          ? parseModels(merged.OLLAMA_MODELS, DEFAULT_OLLAMA_MODELS)
          : provider === 'lmstudio'
            ? parseModels(merged.LMSTUDIO_MODELS, DEFAULT_LMSTUDIO_MODELS)
            : provider === 'local'
              ? parseModels(merged.LOCAL_MODELS, DEFAULT_LOCAL_MODELS)
              : provider === 'vercel'
                ? parseModels(merged.VERCEL_MODELS, DEFAULT_VERCEL_MODELS)
                : provider === 'cloudflare'
                  ? parseModels(merged.CLOUDFLARE_MODELS, DEFAULT_CLOUDFLARE_MODELS)
                  : provider === 'together'
                    ? parseModels(merged.TOGETHER_MODELS, DEFAULT_TOGETHER_MODELS)
                    : parseModels(merged.OPENROUTER_MODELS, DEFAULT_OPENROUTER_MODELS);

  let models = rawModels;
  const preferredModelId = merged.MUGIL_IDE_MODEL || merged.AI_MODEL;
  if (preferredModelId) {
    const existingIndex = models.findIndex((m) => m.id === preferredModelId);
    if (existingIndex > 0) {
      const preferred = models[existingIndex]!;
      models = [preferred, ...models.slice(0, existingIndex), ...models.slice(existingIndex + 1)];
    } else if (existingIndex === -1) {
      models = [
        {
          id: preferredModelId,
          tier: 'standard',
          costPerMTokIn: 0,
          costPerMTokOut: 0,
          contextWindow: 128000,
          supportsThinking: modelSupportsThinking(preferredModelId),
          supportsTools: modelSupportsTools(preferredModelId),
        },
        ...models,
      ];
    }
  }

  return {
    provider,
    openRouterApiKey,
    openRouterBaseUrl: merged.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    openaiApiKey,
    openaiBaseUrl: merged.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    anthropicApiKey,
    anthropicBaseUrl: merged.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    ollamaBaseUrl: merged.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    lmstudioBaseUrl: merged.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
    localBaseUrl: merged.LOCAL_BASE_URL || 'http://localhost:8000/v1',
    vercelApiKey,
    vercelBaseUrl: merged.VERCEL_BASE_URL || 'https://api.vercel.ai/v1',
    cloudflareApiKey,
    cloudflareAccountId: merged.CLOUDFLARE_ACCOUNT_ID || undefined,
    cloudflareBaseUrl: merged.CLOUDFLARE_BASE_URL || 'https://api.cloudflare.com/client/v4',
    togetherApiKey,
    togetherBaseUrl: merged.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
    redisUrl: merged.REDIS_URL || undefined,
    redisClusterUrls: parseList(merged.REDIS_CLUSTER_URLS),
    cacheDir: merged.MUGIL_IDE_CACHE_DIR || defaultCacheDir,
    nodeEnv: merged.NODE_ENV || 'development',
    aiDebug: parseBool(merged.AI_DEBUG, false),
    tokenBudget: Number.isFinite(tokenBudget) && tokenBudget > 0 ? tokenBudget : 10000,
    cacheTtlSeconds: Number.isFinite(cacheTtl) && cacheTtl > 0 ? cacheTtl : 3600,
    models,
    embedding: {
      apiKey: openaiApiKey,
      model: merged.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      baseUrl: merged.OPENAI_EMBEDDING_BASE_URL || 'https://api.openai.com/v1',
    },
  };
}
