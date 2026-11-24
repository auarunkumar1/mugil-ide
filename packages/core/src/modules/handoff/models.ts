import type { ModelSpec } from '../../types.js';
import { VERSION } from '../../branding.js';
import { OPENCODE_USER_AGENT, opencodeBaseUrls, resolveOpenCodePlan } from './openCode.js';
import {
  modelSupportsThinking,
  modelSupportsTools,
  type CompletionProvider,
} from '../../config.js';

export interface FetchModelsOptions {
  provider: CompletionProvider;
  apiKey?: string;
  baseUrl?: string;
  /** Cloudflare account id (its model catalog lives under /accounts/{id}). */
  accountId?: string;
  timeoutMs?: number;
  /** Cache duration in milliseconds (defaults to MUGIL_IDE_MODELS_CACHE_TTL or 60,000ms). */
  cacheTtlMs?: number;
}

/** In-memory cache of fetched models per provider+endpoint to avoid slow redundant network probes. */
const modelsCache = new Map<string, { models: ModelSpec[]; timestamp: number }>();
export const DEFAULT_MODELS_CACHE_TTL_MS = 60_000; // 1 minute

const subscriptionCache = new Map<string, { isGo: boolean; timestamp: number }>();
export const SUBSCRIPTION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearSubscriptionCache(): void {
  subscriptionCache.clear();
}

/**
 * Detects whether the user's OpenCode API key is subscribed to OpenCode Go.
 * Uses resolveOpenCodePlan against GET /inference/go/v1/usage.
 */
export async function detectOpenCodeSubscription(
  apiKey?: string,
  timeoutMs = 3000,
): Promise<boolean> {
  if (!apiKey) return false;
  try {
    const res = await resolveOpenCodePlan(apiKey, undefined, timeoutMs);
    return res.plan === 'go';
  } catch {
    return false;
  }
}

export function clearModelsCache(): void {
  modelsCache.clear();
}

/**
 * Fetches the available models directly from the provider endpoint.
 * Works with OpenRouter, OpenAI, Anthropic, Ollama, LM Studio, and generic local OpenAI endpoints.
 */
export async function fetchProviderModels(options: FetchModelsOptions): Promise<ModelSpec[]> {
  const { provider, apiKey, baseUrl, timeoutMs = 4000 } = options;
  const envTtl =
    typeof process !== 'undefined' && process.env?.MUGIL_IDE_MODELS_CACHE_TTL
      ? Number(process.env.MUGIL_IDE_MODELS_CACHE_TTL)
      : undefined;
  const effectiveTtl =
    options.cacheTtlMs ??
    (envTtl !== undefined && !isNaN(envTtl) ? envTtl : DEFAULT_MODELS_CACHE_TTL_MS);
  const cacheKey = `${provider}:${baseUrl || 'default'}:${options.accountId || ''}:${apiKey ? 'auth' : 'noauth'}`;
  const cached = modelsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < effectiveTtl) {
    return cached.models;
  }

  try {
    if (provider === 'openrouter') {
      const url = `${baseUrl || 'https://openrouter.ai/api/v1'}/models`;
      const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{
            id: string;
            name?: string;
            context_length?: number;
            pricing?: {
              prompt?: string;
              completion?: string;
              input_cache_read?: string;
              input_cache_write?: string;
            };
            top_provider?: {
              max_completion_tokens?: number;
              is_moderated?: boolean;
            };
            supported_parameters?: string[];
          }>;
        };
        if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          const list: ModelSpec[] = json.data.map((m) => {
            const costIn = m.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : 0;
            const costOut = m.pricing?.completion ? Number(m.pricing.completion) * 1_000_000 : 0;
            const cacheIn = m.pricing?.input_cache_read
              ? Number(m.pricing.input_cache_read) * 1_000_000
              : undefined;
            const cacheWrite = m.pricing?.input_cache_write
              ? Number(m.pricing.input_cache_write) * 1_000_000
              : undefined;
            const tier: ModelSpec['tier'] =
              costOut > 5 ? 'smart' : costOut > 0.5 ? 'standard' : 'cheap';
            const costPerMTokCacheRead =
              cacheIn !== undefined && !isNaN(cacheIn) ? cacheIn : costIn > 0 ? costIn * 0.1 : 0;
            const costPerMTokCacheWrite =
              cacheWrite !== undefined && !isNaN(cacheWrite) ? cacheWrite : undefined;
            const hasReasoning =
              Array.isArray(m.supported_parameters) &&
              (m.supported_parameters.includes('reasoning') ||
                m.supported_parameters.includes('include_reasoning'));
            return {
              id: m.id,
              name: m.name,
              tier,
              costPerMTokIn: isNaN(costIn) ? 0 : costIn,
              costPerMTokOut: isNaN(costOut) ? 0 : costOut,
              costPerMTokCacheRead,
              costPerMTokCacheWrite,
              contextWindow: m.context_length || 128000,
              maxOutputTokens: m.top_provider?.max_completion_tokens,
              supportsThinking: hasReasoning || modelSupportsThinking(m.id),
              supportsTools: Array.isArray(m.supported_parameters)
                ? m.supported_parameters.includes('tools')
                : modelSupportsTools(m.id),
            };
          });
          modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
          return list;
        }
      }
    }

    if (provider === 'opencode') {
      const isExplicitGo = /\/inference\/go$/.test((baseUrl || '').replace(/\/+$/, ''));
      const isExplicitZen =
        Boolean(baseUrl) &&
        !isExplicitGo &&
        (baseUrl!.includes('/zen') || (baseUrl!.includes('/inference') && !baseUrl!.includes('/go')));
      let isGo = isExplicitGo;
      if (!isExplicitGo && !isExplicitZen && apiKey) {
        isGo = await detectOpenCodeSubscription(apiKey, Math.min(timeoutMs, 2500));
      }
      const url = isGo
        ? 'https://opencode.ai/inference/go/v1/models'
        : opencodeBaseUrls(baseUrl).models;
      const isConsoleOrGo = isGo || /\/inference(\/go)?$/.test((baseUrl || '').replace(/\/+$/, ''));
      const res = await fetch(url, {
        headers: {
          'User-Agent': isConsoleOrGo ? `mugil-ide/${VERSION}` : OPENCODE_USER_AGENT,
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{
            id: string;
            name?: string;
            type?: string;
            api?:
              | string
              | {
                  messages?: boolean | string;
                  responses?: boolean | string;
                  chat_completions?: boolean | string;
                };
            context_length?: number;
            limit?: { context?: number; output?: number };
            cost?: {
              text?: {
                input?: { price?: number; cache?: { read?: number; write?: number } };
                output?: { price?: number };
              };
            };
            capabilities?: {
              tools?: { supported?: boolean };
              reasoning?: { supported?: boolean; max_budget?: number };
            };
            go?: unknown;
          }>;
        };
        if (json.data && json.data.length > 0) {
          const providerLabel = isGo ? 'OpenCode Go' : 'OpenCode Zen';
          const list: ModelSpec[] = json.data
            .filter((m) => {
              if (m.type && m.type !== 'chat') return false;
              return true;
            })
            .map((m) => {
              const ctx = m.limit?.context || m.context_length || 128000;
              const maxOutput = m.limit?.output;
              const costIn = m.cost?.text?.input?.price ?? 0;
              const costOut = m.cost?.text?.output?.price ?? 0;
              const cacheIn = m.cost?.text?.input?.cache?.read;
              const cacheWrite = m.cost?.text?.input?.cache?.write;
              const costPerMTokCacheRead =
                cacheIn !== undefined ? cacheIn : costIn > 0 ? costIn * 0.1 : 0;
              const costPerMTokCacheWrite =
                cacheWrite !== undefined ? cacheWrite : undefined;
              const tier: ModelSpec['tier'] = m.cost
                ? costOut > 5
                  ? 'smart'
                  : costOut > 0.5
                    ? 'standard'
                    : 'cheap'
                : 'standard';

              let protocol: ModelSpec['protocol'] = undefined;
              if (typeof m.api === 'string') {
                if (m.api.includes('response')) protocol = 'responses';
                else if (m.api.includes('message')) protocol = 'messages';
                else if (m.api.includes('chat')) protocol = 'chat';
              } else if (m.api && typeof m.api === 'object') {
                if (m.api.responses) protocol = 'responses';
                else if (m.api.messages) protocol = 'messages';
                else if (m.api.chat_completions) protocol = 'chat';
              }
              if (!protocol) {
                if (/^(gpt|codex)/.test(m.id)) {
                  protocol = 'responses';
                } else if (/^claude/.test(m.id)) {
                  protocol = 'messages';
                } else {
                  protocol = 'chat';
                }
              }

              return {
                id: m.id,
                name: m.name,
                tier,
                costPerMTokIn: costIn,
                costPerMTokOut: costOut,
                costPerMTokCacheRead,
                costPerMTokCacheWrite,
                contextWindow: ctx,
                maxOutputTokens: maxOutput,
                protocol,
                supportsThinking:
                  m.capabilities?.reasoning?.supported !== undefined
                    ? m.capabilities.reasoning.supported
                    : modelSupportsThinking(m.id),
                supportsTools:
                  m.capabilities?.tools?.supported !== undefined
                    ? m.capabilities.tools.supported
                    : modelSupportsTools(m.id),
                provider: 'opencode',
                providerLabel,
                isGo,
              };
            });
          if (isGo) {
            const GO_ORDER: Record<string, number> = {
              'deepseek-v4.1-flash': 100,
              'claude-haiku-5-5': 95,
              'beam-free': 90,
              'hy4-flash-free': 85,
              'qwen4-max': 80,
              'deepseek-v4-pro': 75,
              'grok-4.7': 70,
              'gemini-4-argon': 65,
              'longcat-2.5-free': 60,
              'iceman-contributor-free': 55,
            };
            list.sort((a, b) => (GO_ORDER[b.id] || 0) - (GO_ORDER[a.id] || 0));
          }
          modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
          return list;
        }
      }
    }

    if (provider === 'ollama') {
      const ep = baseUrl || 'http://localhost:11434/v1';
      const endpointsToTry = [
        ep,
        ep.includes('localhost')
          ? ep.replace('localhost', '127.0.0.1')
          : ep.replace('127.0.0.1', 'localhost'),
      ];

      for (const currentEp of endpointsToTry) {
        // 1. Try standard OpenAI /v1/models endpoint
        try {
          const res = await fetch(`${currentEp.replace(/\/+$/, '')}/models`, {
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) {
            const json = (await res.json()) as { data?: Array<{ id: string }> };
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
              const list: ModelSpec[] = json.data.map((m) => ({
                id: m.id,
                tier: 'standard',
                costPerMTokIn: 0,
                costPerMTokOut: 0,
                contextWindow: 128000,
                supportsThinking: modelSupportsThinking(m.id),
                supportsTools: modelSupportsTools(m.id),
              }));
              modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
              return list;
            }
          }
        } catch {
          // try native tags
        }

        // 2. Try native Ollama /api/tags endpoint
        try {
          const origin = currentEp.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
          const nativeRes = await fetch(`${origin}/api/tags`, {
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (nativeRes.ok) {
            const json = (await nativeRes.json()) as {
              models?: Array<{ name?: string; model?: string; id?: string }>;
            };
            if (json.models && Array.isArray(json.models) && json.models.length > 0) {
              const list: ModelSpec[] = json.models
                .map((m) => m.name || m.model || m.id)
                .filter((name): name is string => Boolean(name && typeof name === 'string'))
                .map((name) => ({
                  id: name,
                  tier: 'standard',
                  costPerMTokIn: 0,
                  costPerMTokOut: 0,
                  contextWindow: 128000,
                  supportsThinking: modelSupportsThinking(name),
                  supportsTools: modelSupportsTools(name),
                }));
              if (list.length > 0) {
                modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
                return list;
              }
            }
          }
        } catch {
          // continue loop
        }
      }
    }

    if (provider === 'lmstudio' || provider === 'local' || provider === 'openai' || provider === 'llamacpp') {
      const ep =
        provider === 'lmstudio'
          ? baseUrl || 'http://localhost:1234/v1'
          : provider === 'llamacpp'
            ? baseUrl || 'http://127.0.0.1:8080/v1'
            : provider === 'local'
              ? baseUrl || 'http://localhost:8000/v1'
              : baseUrl || 'https://api.openai.com/v1';

      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(`${ep}/models`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          const list: ModelSpec[] = json.data.map((m) => ({
            id: m.id,
            tier:
              m.id.includes('mini') || m.id.includes('small')
                ? 'cheap'
                : m.id.includes('o1') || m.id.includes('o3') || m.id.includes('r1')
                  ? 'smart'
                  : 'standard',
            costPerMTokIn: 0,
            costPerMTokOut: 0,
            contextWindow: 128000,
            supportsThinking: modelSupportsThinking(m.id),
            supportsTools: modelSupportsTools(m.id),
          }));
          modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
          return list;
        }
      }
    }

    if (provider === 'anthropic') {
      const ep = baseUrl || 'https://api.anthropic.com';
      if (apiKey) {
        const res = await fetch(`${ep}/v1/models`, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            data?: Array<{ id: string; display_name?: string }>;
          };
          if (json.data && Array.isArray(json.data) && json.data.length > 0) {
            const list: ModelSpec[] = json.data.map((m) => ({
              id: m.id,
              tier: m.id.includes('haiku') ? 'cheap' : 'smart',
              costPerMTokIn: m.id.includes('haiku') ? 0.8 : 3,
              costPerMTokOut: m.id.includes('haiku') ? 4 : 15,
              contextWindow: 200000,
              supportsThinking: modelSupportsThinking(m.id),
              supportsTools: modelSupportsTools(m.id),
            }));
            modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
            return list;
          }
        }
      }
    }

    // Vercel AI Gateway — OpenAI-compatible /v1/models. Model ids are
    // namespaced (`creator/model`) and the catalog carries real pricing and
    // context windows, so prefer those over the substring heuristics.
    if (provider === 'vercel') {
      const ep = baseUrl || 'https://ai-gateway.vercel.sh/v1';
      if (apiKey) {
        try {
          const res = await fetch(`${ep}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              data?: Array<{
                id: string;
                context_window?: number;
                supported_parameters?: string[];
                pricing?: { input?: string; output?: string };
              }>;
            };
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
              // The catalog prices per token — convert to per-MTok.
              const perMTok = (v?: string): number => {
                const n = Number(v);
                return Number.isFinite(n) && n > 0 ? n * 1_000_000 : 0;
              };
              const list: ModelSpec[] = json.data.map((m) => {
                const id = m.id.toLowerCase();
                return {
                  id: m.id,
                  tier:
                    id.includes('mini') ||
                    id.includes('small') ||
                    id.includes('flash') ||
                    id.includes('haiku')
                      ? 'cheap'
                      : id.includes('r1') || id.includes('thinking')
                        ? 'smart'
                        : 'standard',
                  costPerMTokIn: perMTok(m.pricing?.input),
                  costPerMTokOut: perMTok(m.pricing?.output),
                  contextWindow: m.context_window ?? 128000,
                  supportsThinking:
                    modelSupportsThinking(m.id) ||
                    (m.supported_parameters ?? []).includes('reasoning'),
                  supportsTools: modelSupportsTools(m.id),
                };
              });
              modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
              return list;
            }
          }
        } catch {
          // fall through to curated list
        }
      }
    }

    // Cloudflare Workers AI — OpenAI-compatible /ai/v1/models
    if (provider === 'cloudflare') {
      const ep = baseUrl || 'https://api.cloudflare.com/client/v4';
      const accountId = options.accountId ?? options.baseUrl?.match(/accounts\/([^/]+)/)?.[1];
      if (apiKey && accountId) {
        try {
          const res = await fetch(`${ep}/accounts/${accountId}/ai/models/search`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) {
            const json = (await res.json()) as { result?: Array<{ id: string; name?: string }> };
            if (json.result && Array.isArray(json.result) && json.result.length > 0) {
              const list: ModelSpec[] = json.result.map((m) => ({
                id: m.id,
                tier: 'standard',
                costPerMTokIn: 0,
                costPerMTokOut: 0,
                contextWindow: 128000,
                supportsThinking: modelSupportsThinking(m.id),
                supportsTools: modelSupportsTools(m.id),
              }));
              modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
              return list;
            }
          }
        } catch {
          // fall through to curated list
        }
      }
    }

    // Together AI — OpenAI-compatible /v1/models
    if (provider === 'together') {
      const ep = baseUrl || 'https://api.together.xyz/v1';
      if (apiKey) {
        try {
          const res = await fetch(`${ep}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              data?: Array<{ id: string; display_name?: string }>;
            };
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
              const list: ModelSpec[] = json.data.map((m) => ({
                id: m.id,
                tier:
                  m.id.includes('turbo') || m.id.includes('small')
                    ? 'cheap'
                    : m.id.includes('r1') || m.id.includes('qwq')
                      ? 'smart'
                      : 'standard',
                costPerMTokIn: 0,
                costPerMTokOut: 0,
                contextWindow: 128000,
                supportsThinking: modelSupportsThinking(m.id),
                supportsTools: modelSupportsTools(m.id),
              }));
              modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
              return list;
            }
          }
        } catch {
          // fall through to curated list
        }
      }
    }
  } catch {
    // Network probe failed or timed out — return empty list
  }

  return [];
}
