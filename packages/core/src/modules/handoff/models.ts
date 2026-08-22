import type { ModelSpec } from '../../types.js';
import {
  modelSupportsThinking,
  modelSupportsTools,
  type CompletionProvider,
} from '../../config.js';

export interface FetchModelsOptions {
  provider: CompletionProvider;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** In-memory cache of fetched models per provider+endpoint to avoid slow redundant network probes. */
const modelsCache = new Map<string, { models: ModelSpec[]; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Fetches the available models directly from the provider endpoint.
 * Works with OpenRouter, OpenAI, Anthropic, Ollama, LM Studio, and generic local OpenAI endpoints.
 */
export async function fetchProviderModels(options: FetchModelsOptions): Promise<ModelSpec[]> {
  const { provider, apiKey, baseUrl, timeoutMs = 4000 } = options;
  const cacheKey = `${provider}:${baseUrl || 'default'}:${apiKey ? 'auth' : 'noauth'}`;
  const cached = modelsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
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
            pricing?: { prompt?: string; completion?: string };
            supported_parameters?: string[];
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
      const url = `${baseUrl || 'https://opencode.ai/zen/v1'}/models`;
      const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{ id: string; context_length?: number }>;
        };
        if (json.data && json.data.length > 0) {
          const list: ModelSpec[] = json.data.map((m) => ({
            id: m.id,
            tier: 'standard' as const,
            costPerMTokIn: 0,
            costPerMTokOut: 0,
            contextWindow: m.context_length || 128000,
            supportsThinking: modelSupportsThinking(m.id),
            supportsTools: modelSupportsTools(m.id),
          }));
          modelsCache.set(cacheKey, { models: list, timestamp: Date.now() });
          return list;
        }
      }
    }

    if (provider === 'ollama') {
      const ep = baseUrl || 'http://localhost:11434/v1';
      const endpointsToTry = [
        ep,
        ep.includes('localhost') ? ep.replace('localhost', '127.0.0.1') : ep.replace('127.0.0.1', 'localhost'),
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
            const json = (await nativeRes.json()) as { models?: Array<{ name?: string; model?: string; id?: string }> };
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

    if (provider === 'lmstudio' || provider === 'local' || provider === 'openai') {
      const ep =
        provider === 'lmstudio'
          ? baseUrl || 'http://localhost:1234/v1'
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
            tier: m.id.includes('mini') || m.id.includes('small') ? 'cheap' : m.id.includes('o1') || m.id.includes('o3') || m.id.includes('r1') ? 'smart' : 'standard',
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
          const json = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
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

    // Vercel AI Gateway — OpenAI-compatible /v1/models
    if (provider === 'vercel') {
      const ep = baseUrl || 'https://api.vercel.ai/v1';
      if (apiKey) {
        try {
          const res = await fetch(`${ep}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) {
            const json = (await res.json()) as { data?: Array<{ id: string }> };
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
              const list: ModelSpec[] = json.data.map((m) => ({
                id: m.id,
                tier: m.id.includes('mini') || m.id.includes('small') ? 'cheap' : m.id.includes('r1') || m.id.includes('thinking') ? 'smart' : 'standard',
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

    // Cloudflare Workers AI — OpenAI-compatible /ai/v1/models
    if (provider === 'cloudflare') {
      const ep = baseUrl || 'https://api.cloudflare.com/client/v4';
      const accountId = options.baseUrl?.match(/accounts\/([^/]+)/)?.[1];
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
            const json = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
              const list: ModelSpec[] = json.data.map((m) => ({
                id: m.id,
                tier: m.id.includes('turbo') || m.id.includes('small') ? 'cheap' : m.id.includes('r1') || m.id.includes('qwq') ? 'smart' : 'standard',
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
