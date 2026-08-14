import * as os from 'node:os';
import * as path from 'node:path';
import type { ModelSpec } from './types.js';
import { readUserEnv } from './env.js';

/** Default OpenRouter model ladder used when OPENROUTER_MODELS is not set. */
const DEFAULT_MODELS: ModelSpec[] = [
  { id: 'openrouter/auto', tier: 'cheap', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 },
  {
    id: 'mistralai/mistral-small',
    tier: 'standard',
    costPerMTokIn: 0.2,
    costPerMTokOut: 0.6,
    contextWindow: 32000,
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    tier: 'smart',
    costPerMTokIn: 3,
    costPerMTokOut: 15,
    contextWindow: 200000,
  },
];

/** Default OpenAI ladder used when OPENAI_MODELS is not set. */
const DEFAULT_OPENAI_MODELS: ModelSpec[] = [
  { id: 'gpt-4o-mini', tier: 'cheap', costPerMTokIn: 0.15, costPerMTokOut: 0.6, contextWindow: 128000 },
  { id: 'gpt-4o', tier: 'standard', costPerMTokIn: 2.5, costPerMTokOut: 10, contextWindow: 128000 },
  { id: 'gpt-4.1', tier: 'smart', costPerMTokIn: 2, costPerMTokOut: 8, contextWindow: 1000000 },
];

/** Default Anthropic ladder used when ANTHROPIC_MODELS is not set. */
const DEFAULT_ANTHROPIC_MODELS: ModelSpec[] = [
  { id: 'claude-3-5-haiku', tier: 'cheap', costPerMTokIn: 0.8, costPerMTokOut: 4, contextWindow: 200000 },
  { id: 'claude-3-5-sonnet', tier: 'standard', costPerMTokIn: 3, costPerMTokOut: 15, contextWindow: 200000 },
  { id: 'claude-sonnet-4', tier: 'smart', costPerMTokIn: 3, costPerMTokOut: 15, contextWindow: 200000 },
];

export type CompletionProvider = 'openrouter' | 'openai' | 'anthropic';

export interface AppConfig {
  /** The provider the engine talks to (OpenRouter primary; else OpenAI/Anthropic). */
  provider: CompletionProvider;
  openRouterApiKey?: string;
  openRouterBaseUrl: string;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
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
  const merged: NodeJS.ProcessEnv = { ...userFile, ...env };

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

  // Provider resolution: OpenRouter is primary; AI_PROVIDER overrides.
  const requested = (merged.AI_PROVIDER ?? '').toLowerCase();
  const provider: CompletionProvider =
    requested === 'openai'
      ? 'openai'
      : requested === 'anthropic'
        ? 'anthropic'
        : openRouterApiKey
          ? 'openrouter'
          : openaiApiKey
            ? 'openai'
            : anthropicApiKey
              ? 'anthropic'
              : 'openrouter';

  const models =
    provider === 'openai'
      ? parseModels(merged.OPENAI_MODELS, DEFAULT_OPENAI_MODELS)
      : provider === 'anthropic'
        ? parseModels(merged.ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODELS)
        : parseModels(merged.OPENROUTER_MODELS, DEFAULT_MODELS);

  return {
    provider,
    openRouterApiKey,
    openRouterBaseUrl: merged.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    openaiApiKey,
    openaiBaseUrl: merged.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    anthropicApiKey,
    anthropicBaseUrl: merged.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
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
