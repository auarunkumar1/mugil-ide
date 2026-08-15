import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import {
  BRAND,
  loadConfig,
  readUserEnv,
  writeUserEnv,
  modelSupportsThinking,
  fetchProviderModels,
  resolveFileContext,
  type Engine,
  type AskResult,
  type PipelineEvent,
  type ThinkingLevel,
  type ModelSpec,
} from '@mugil-ide/core';
import { MugilLogo } from './logo.js';
import { Dropdown, type DropdownItem } from './dropdown.js';
import { AccountsMenu } from './accounts.js';
import { StartupBanner } from './startupBanner.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_MS = 90;

type Mode = 'act' | 'plan';
type ThinkingPref = 'show' | 'hide';

// Persisted TUI preferences (stored in the user env file, see core env.ts).
const TUI_MODE_VAR = 'MUGIL_IDE_TUI_MODE';
const TUI_THINKING_VAR = 'MUGIL_IDE_TUI_THINKING';
const TUI_MODEL_VAR = 'MUGIL_IDE_MODEL';
const TUI_THINKING_LEVEL_VAR = 'MUGIL_IDE_THINKING_LEVEL';

function initialMode(): Mode {
  const value = readUserEnv()[TUI_MODE_VAR]?.toLowerCase();
  return value === 'plan' ? 'plan' : 'act';
}

function initialThinkingPref(): ThinkingPref {
  const value = readUserEnv()[TUI_THINKING_VAR]?.toLowerCase();
  return value === 'show' ? 'show' : 'hide';
}

function initialModel(fallback: string): string {
  return readUserEnv()[TUI_MODEL_VAR] || fallback;
}

function initialThinkingLevel(): ThinkingLevel {
  const val = readUserEnv()[TUI_THINKING_LEVEL_VAR]?.toLowerCase();
  if (val === 'low' || val === 'medium' || val === 'high') return val;
  return 'off';
}

/** Best-effort persistence — never blocks or crashes the TUI. */
function persistPrefs(prefs: Record<string, string>): void {
  try {
    writeUserEnv(prefs);
  } catch {
    // prefs are a nicety; ignore write failures
  }
}

const PLAN_INSTRUCTION =
  'You are in PLAN mode: produce a concise, numbered step-by-step plan only. ' +
  'No code, no implementation, no file edits. Keep it under ~300 tokens.';

const MODE_LABEL: Record<Mode, string> = { act: 'act', plan: 'plan' };

interface Entry {
  id: number;
  prompt: string;
  status: 'pending' | 'done' | 'error';
  result?: AskResult;
  error?: string;
}

interface LiveStatus {
  stage: string;
  originalTokens?: number;
  refinedTokens?: number;
  totalTokens?: number;
  model?: string;
}

interface ChatAppProps {
  engine: Engine;
  onExit: () => void;
}

const MAX_ENTRIES = 50;

/** Ollama returns IDs like `llama3.2:latest`; strip only the recency alias when comparing. */
function stripLatestTag(id: string): string {
  return id.replace(/:latest$/i, '');
}

/** True when the fetched catalog contains the model (ignoring the `:latest` alias). */
function catalogHas(models: ModelSpec[], id: string): boolean {
  const bare = stripLatestTag(id);
  return models.some((m) => m.id === id || stripLatestTag(m.id) === bare);
}

const THINKING_LEVEL_OPTIONS: DropdownItem<ThinkingLevel>[] = [
  { label: 'Off', value: 'off', description: 'Standard response, no extended reasoning' },
  { label: 'Low', value: 'low', description: 'Fast reasoning (~1k thinking tokens)' },
  { label: 'Medium', value: 'medium', description: 'Balanced reasoning (~4k thinking tokens)' },
  { label: 'High', value: 'high', description: 'Deep reasoning (~16k thinking tokens)' },
];

export function ChatApp({ engine, onExit }: ChatAppProps): React.ReactElement {
  const { exit } = useApp();
  const [config, setConfig] = useState(engine.config);
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [thinkingPref, setThinkingPref] = useState<ThinkingPref>(initialThinkingPref);
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    initialModel(config.models[0]?.id || 'openrouter/auto'),
  );
  // True once the user has explicitly chosen a model (dropdown or custom ID) —
  // stops background catalog refreshes from silently swapping the selection.
  const userPickedRef = React.useRef(Boolean(readUserEnv()[TUI_MODEL_VAR]));
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(initialThinkingLevel);
  const [live, setLive] = useState<LiveStatus>({ stage: '' });
  const [modelsList, setModelsList] = useState<ModelSpec[]>(config.models);
  const [customModelInput, setCustomModelInput] = useState('');
  const [activeView, setActiveView] = useState<'chat' | 'modelDropdown' | 'customModelInput' | 'thinkingDropdown' | 'accounts'>('chat');
  const nextId = React.useRef(1);

  // Animated "working" spinner while a request is in flight.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), SPINNER_MS);
    return () => clearInterval(id);
  }, [busy]);

  // Fetch remote / local provider model catalogue in background when provider/keys change.
  useEffect(() => {
    let active = true;
    const apiKey =
      config.provider === 'openrouter'
        ? config.openRouterApiKey
        : config.provider === 'openai'
          ? config.openaiApiKey
          : config.provider === 'anthropic'
            ? config.anthropicApiKey
            : undefined;

    const baseUrl =
      config.provider === 'ollama'
        ? config.ollamaBaseUrl
        : config.provider === 'lmstudio'
          ? config.lmstudioBaseUrl
          : config.provider === 'local'
            ? config.localBaseUrl
            : config.provider === 'openrouter'
              ? config.openRouterBaseUrl
              : config.provider === 'openai'
                ? config.openaiBaseUrl
                : config.anthropicBaseUrl;

    fetchProviderModels({ provider: config.provider, apiKey, baseUrl }).then((models) => {
      if (active && models.length > 0) {
        setModelsList(models);
        engine.handoff?.setModels?.(models);
        setSelectedModel((curr) => {
          // `openrouter/auto` is the routing default — keep it for OpenRouter.
          if (curr === 'openrouter/auto' && config.provider === 'openrouter') return curr;
          // Keep a selection that still exists in the fetched catalog.
          if (catalogHas(models, curr)) return curr;
          // Never clobber an explicit user pick — the handoff layer surfaces a
          // clear error if the model is unavailable instead of silently
          // swapping in another one (e.g. DeepSeek).
          if (userPickedRef.current) return curr;
          // Untouched config default: adopt the first model the provider
          // actually exposes.
          return models[0]?.id ?? curr;
        });
      }
    });
    return () => {
      active = false;
    };
  }, [
    config.provider,
    config.openRouterApiKey,
    config.openaiApiKey,
    config.anthropicApiKey,
    config.ollamaBaseUrl,
    config.lmstudioBaseUrl,
    config.localBaseUrl,
  ]);

  // Resolve the exit promise once the Ink app unmounts (Ctrl+C or /quit).
  useEffect(() => {
    return () => {
      onExit();
    };
  }, [onExit]);

  const isLive = Boolean(
    config.openRouterApiKey ||
    config.openaiApiKey ||
    config.anthropicApiKey ||
    config.provider === 'ollama' ||
    config.provider === 'lmstudio' ||
    config.provider === 'local',
  );

  function reloadConfig(): void {
    const updated = loadConfig();
    const providerChanged = updated.provider !== config.provider;
    engine.reconfigure(updated);
    setConfig(updated);
    setModelsList(updated.models);
    // Only adopt the new ladder default when the provider actually changed;
    // otherwise preserve the user's current model selection.
    if (providerChanged) {
      setSelectedModel(updated.models[0]?.id ?? selectedModel);
    }
  }

  const modelDropdownItems: DropdownItem<string>[] = [
    ...modelsList.map((m) => ({
      label: m.id,
      value: m.id,
      description: `${m.tier} tier · ${Math.round(m.contextWindow / 1000)}k ctx`,
      hint: m.supportsThinking || modelSupportsThinking(m.id) ? '🧠 thinking' : undefined,
    })),
    // Keep the pseudo-item last so the initial highlight (and an accidental
    // Enter) always lands on a real model, never on the custom-ID screen.
    {
      label: '✏ Custom Model ID…',
      value: '__custom__',
      description: 'Enter any custom model ID manually',
    },
  ];

  async function submit(): Promise<void> {
    const prompt = input.trim();
    if (!prompt || busy) return;
    if (prompt === '/quit' || prompt === '/exit') {
      exit();
      return;
    }
    if (prompt === '/plan' || prompt === '/act') {
      const next = prompt === '/plan' ? 'plan' : 'act';
      setMode(next);
      persistPrefs({ [TUI_MODE_VAR]: next, [TUI_THINKING_VAR]: thinkingPref });
      setInput('');
      return;
    }
    if (prompt === '/thinking-view') {
      const next = thinkingPref === 'show' ? 'hide' : 'show';
      setThinkingPref(next);
      persistPrefs({ [TUI_THINKING_VAR]: next });
      setInput('');
      return;
    }
    if (prompt === '/model' || prompt === '/models') {
      const apiKey =
        config.provider === 'openrouter'
          ? config.openRouterApiKey
          : config.provider === 'openai'
            ? config.openaiApiKey
            : config.anthropicApiKey;
      const baseUrl =
        config.provider === 'ollama'
          ? config.ollamaBaseUrl
          : config.provider === 'lmstudio'
            ? config.lmstudioBaseUrl
            : config.provider === 'local'
              ? config.localBaseUrl
              : config.provider === 'openrouter'
                ? config.openRouterBaseUrl
                : config.provider === 'openai'
                  ? config.openaiBaseUrl
                  : config.anthropicBaseUrl;

      fetchProviderModels({ provider: config.provider, apiKey, baseUrl, timeoutMs: 3000 }).then((models) => {
        if (models.length > 0) {
          setModelsList(models);
          engine.handoff?.setModels?.(models);
        }
      });
      setActiveView('modelDropdown');
      setInput('');
      return;
    }
    if (prompt === '/thinking' || prompt === '/thinking-level' || prompt === '/reasoning') {
      setActiveView('thinkingDropdown');
      setInput('');
      return;
    }
    if (prompt === '/accounts' || prompt === '/account' || prompt === '/login') {
      setActiveView('accounts');
      setInput('');
      return;
    }
    if (prompt === '/clear-cache' || prompt === '/purge-cache') {
      setInput('');
      try {
        await engine.cache?.clear?.();
      } catch {
        // cache clearing is best-effort; never crash the TUI
      }
      const entry: Entry = {
        id: nextId.current++,
        prompt: '/clear-cache',
        status: 'done',
        result: {
          response: '✓ Cache purged successfully.',
          model: 'system',
          provider: 'system',
          mock: false,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          refine: { original: '', refined: '', originalTokens: 0, refinedTokens: 0, savingsPct: 0, appliedStrategies: [] },
          cache: { hit: false },
        },
      };
      setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry]);
      return;
    }

    const { resolvedPrompt, attachedFiles } = resolveFileContext(prompt);
    setInput('');
    const promptDisplay = attachedFiles.length > 0
      ? `${prompt}\n  📎 [Attached: ${attachedFiles.join(', ')}]`
      : prompt;
    const entry: Entry = { id: nextId.current++, prompt: promptDisplay, status: 'pending' };
    setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry]);
    setBusy(true);
    setLive({ stage: 'signature' });
    const activeSpec = modelsList.find((m) => m.id === selectedModel);
    const hasManualBudget = Boolean(process.env.TOKEN_BUDGET);
    const effectiveBudget = hasManualBudget
      ? config.tokenBudget
      : (activeSpec?.contextWindow ?? 128000);

    try {
      const onEvent = (ev: PipelineEvent): void => {
        if (ev.type === 'stage') setLive((l) => ({ ...l, stage: ev.stage }));
        else if (ev.type === 'refined') {
          setLive((l) => ({
            ...l,
            originalTokens: ev.refine.originalTokens,
            refinedTokens: ev.refine.refinedTokens,
          }));
        } else if (ev.type === 'handoff') {
          setLive((l) => ({ ...l, stage: 'handoff', model: ev.model }));
        } else if (ev.type === 'done') {
          setLive((l) => ({ ...l, totalTokens: ev.usage.totalTokens }));
        }
      };
      const result = await engine.pipeline.ask(resolvedPrompt, {
        preferredModel: selectedModel,
        thinkingLevel: thinkingLevel !== 'off' ? thinkingLevel : undefined,
        systemPrompt: mode === 'plan' ? PLAN_INSTRUCTION : undefined,
        tokenBudget: effectiveBudget,
        onEvent,
      });
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, status: 'done', result } : e)),
      );
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? { ...e, status: 'error', error: err instanceof Error ? err.message : String(err) }
            : e,
        ),
      );
    } finally {
      setBusy(false);
      setLive({ stage: '' });
    }
  }

  const spinner = SPINNER_FRAMES[frame]!;
  const modelThinkingSupported = modelSupportsThinking(selectedModel);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <MugilLogo />
      </Box>
      <Header
        config={config}
        modelsList={modelsList}
        mode={mode}
        thinkingPref={thinkingPref}
        selectedModel={selectedModel}
        thinkingLevel={thinkingLevel}
        modelThinkingSupported={modelThinkingSupported}
        isLive={isLive}
      />

      {entries.length === 0 && activeView === 'chat' && (
        <StartupBanner config={config} isLive={isLive} />
      )}

      {activeView === 'modelDropdown' && (
        <Dropdown
          title={`Select Active Model (${config.provider})`}
          items={modelDropdownItems}
          initialValue={selectedModel}
          onSelect={(val) => {
            if (val === '__custom__') {
              setCustomModelInput('');
              setActiveView('customModelInput');
              return;
            }
            userPickedRef.current = true;
            setSelectedModel(val);
            persistPrefs({ [TUI_MODEL_VAR]: val });
            setActiveView('chat');
          }}
          onCancel={() => setActiveView('chat')}
        />
      )}

      {activeView === 'customModelInput' && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          marginY={1}
        >
          <Text color="cyan" bold>
            Enter Custom Model ID:
          </Text>
          <Text dimColor>
            (e.g. deepseek-r1:8b, llama3.2, google/gemini-2.0-flash, anthropic/claude-3.7-sonnet)
          </Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text color="cyan">❯ model: </Text>
            <TextInput
              value={customModelInput}
              onChange={setCustomModelInput}
              onSubmit={(raw) => {
                const val = raw.trim();
                if (val) {
                  userPickedRef.current = true;
                  setSelectedModel(val);
                  persistPrefs({ [TUI_MODEL_VAR]: val });
                }
                setActiveView('chat');
              }}
              placeholder="model-name"
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to confirm, or enter empty string to cancel.</Text>
          </Box>
        </Box>
      )}

      {activeView === 'thinkingDropdown' && (
        <Dropdown
          title={`Select Thinking Level for ${selectedModel}${modelThinkingSupported ? ' (Supported)' : ''}`}
          items={THINKING_LEVEL_OPTIONS}
          initialValue={thinkingLevel}
          onSelect={(val) => {
            setThinkingLevel(val);
            persistPrefs({ [TUI_THINKING_LEVEL_VAR]: val });
            setActiveView('chat');
          }}
          onCancel={() => setActiveView('chat')}
        />
      )}

      {activeView === 'accounts' && (
        <AccountsMenu
          config={config}
          onClose={() => setActiveView('chat')}
          onKeyUpdated={() => {
            reloadConfig();
          }}
        />
      )}

      {busy && <LiveStatusLine status={live} spinner={spinner} />}

      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} spinner={spinner} thinkingPref={thinkingPref} />
        ))}
      </Box>

      {activeView === 'chat' && (
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={submit}
            placeholder={
              busy
                ? spinner
                : `type a prompt, or /model · /thinking · /accounts · /plan · /quit`
            }
          />
        </Box>
      )}
    </Box>
  );
}

function Header({
  config,
  modelsList,
  mode,
  thinkingPref,
  selectedModel,
  thinkingLevel,
  modelThinkingSupported,
  isLive,
}: {
  config: Engine['config'];
  modelsList: ModelSpec[];
  mode: Mode;
  thinkingPref: ThinkingPref;
  selectedModel: string;
  thinkingLevel: ThinkingLevel;
  modelThinkingSupported: boolean;
  isLive: boolean;
}): React.ReactElement {
  const backendName = config.redisUrl ? 'redis' : config.cacheDir ? 'file' : 'memory';
  const activeSpec = modelsList.find((m) => m.id === selectedModel);
  const hasManualBudget = Boolean(process.env.TOKEN_BUDGET);
  const budgetDisplay = hasManualBudget
    ? `${config.tokenBudget} (manual)`
    : `${Math.round((activeSpec?.contextWindow ?? 128000) / 1000)}k (auto)`;

  return (
    <Box flexDirection="column">
      <Text bold color="green">
        ⚡ {BRAND}
      </Text>
      <Text dimColor>
        mode: <Text color={mode === 'plan' ? 'yellow' : 'green'}>{MODE_LABEL[mode]}</Text>
        {' · '}model: <Text color="cyan">{selectedModel}</Text>
        {' · '}thinking: <Text color={thinkingLevel !== 'off' ? 'yellow' : 'gray'}>{thinkingLevel}{modelThinkingSupported ? ' 🧠' : ''}</Text>
        {' · '}view: <Text color={thinkingPref === 'show' ? 'yellow' : 'gray'}>{thinkingPref}</Text>
        {' · '}provider: <Text color={isLive ? 'green' : 'gray'}>{config.provider}</Text> ({isLive ? 'live' : 'mock'}) · cache: {backendName} · budget: <Text color="cyan">{budgetDisplay}</Text>
      </Text>
    </Box>
  );
}

function LiveStatusLine({ status, spinner }: { status: LiveStatus; spinner: string }): React.ReactElement {
  const parts = [
    status.stage && `stage: ${status.stage}`,
    status.model && `model: ${status.model}`,
    status.originalTokens !== undefined &&
      status.refinedTokens !== undefined &&
      `tokens: ${status.originalTokens}→${status.refinedTokens}`,
    status.totalTokens !== undefined && `total: ${status.totalTokens}`,
  ].filter(Boolean);
  return (
    <Box marginTop={1}>
      <Text color="cyan">
        {spinner} {parts.join(' · ') || 'working…'}
      </Text>
    </Box>
  );
}

function EntryView({
  entry,
  spinner,
  thinkingPref,
}: {
  entry: Entry;
  spinner: string;
  thinkingPref: ThinkingPref;
}): React.ReactElement | null {
  if (entry.status === 'pending') {
    return (
      <Box>
        <Text dimColor>
          {spinner} {entry.prompt.slice(0, 60)}…
        </Text>
      </Box>
    );
  }
  if (entry.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ {entry.prompt.slice(0, 60)}</Text>
        <Text color="red" dimColor>
          {entry.error}
        </Text>
      </Box>
    );
  }
  const r = entry.result!;
  const cacheTag = r.cache.hit ? `cache:${r.cache.kind}` : 'cache:miss';
  const strategyTag =
    r.refine.appliedStrategies.length > 0 ? `refine:${r.refine.appliedStrategies.join('+')}` : 'refine:none';
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">
        ❯ {entry.prompt}
      </Text>
      <Text dimColor>
        {r.model}
        {r.mock ? ' (mock)' : ''} · {cacheTag} · {strategyTag} ·{' '}
        {r.refine.originalTokens}→{r.refine.refinedTokens} tok (-{r.refine.savingsPct}%)
        {r.thinking ? ' · 💭' : ''}
      </Text>
      {r.thinking && thinkingPref === 'show' && (
        <Box flexDirection="column" marginTop={1} marginBottom={1} paddingLeft={1}>
          <Text bold color="yellow">
            💭 thinking
          </Text>
          <Text color="yellow" dimColor>
            {r.thinking}
          </Text>
        </Box>
      )}
      <Text color="gray">{r.response}</Text>
    </Box>
  );
}
