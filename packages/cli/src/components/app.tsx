import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { BRAND, readUserEnv, writeUserEnv, type Engine, type AskResult, type PipelineEvent } from '@mugil-ide/core';
import { MugilLogo } from './logo.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_MS = 90;

type Mode = 'act' | 'plan';
type ThinkingPref = 'show' | 'hide';

// Persisted TUI preferences (stored in the user env file, see core env.ts).
const TUI_MODE_VAR = 'MUGIL_IDE_TUI_MODE';
const TUI_THINKING_VAR = 'MUGIL_IDE_TUI_THINKING';

function initialMode(): Mode {
  const value = readUserEnv()[TUI_MODE_VAR]?.toLowerCase();
  return value === 'plan' ? 'plan' : 'act';
}

function initialThinkingPref(): ThinkingPref {
  const value = readUserEnv()[TUI_THINKING_VAR]?.toLowerCase();
  return value === 'show' ? 'show' : 'hide';
}

/** Best-effort persistence — never blocks or crashes the TUI. */
function persistPrefs(mode: Mode, thinking: ThinkingPref): void {
  try {
    writeUserEnv({ [TUI_MODE_VAR]: mode, [TUI_THINKING_VAR]: thinking });
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
}

interface ChatAppProps {
  engine: Engine;
  onExit: () => void;
}

const MAX_ENTRIES = 50;

export function ChatApp({ engine, onExit }: ChatAppProps): React.ReactElement {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [thinkingPref, setThinkingPref] = useState<ThinkingPref>(initialThinkingPref);
  const [live, setLive] = useState<LiveStatus>({ stage: '' });
  const nextId = React.useRef(1);

  const { config } = engine;

  // Animated "working" spinner while a request is in flight.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), SPINNER_MS);
    return () => clearInterval(id);
  }, [busy]);

  // Resolve the exit promise once the Ink app unmounts (Ctrl+C or /quit).
  useEffect(() => {
    return () => {
      onExit();
    };
  }, [onExit]);

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
      persistPrefs(next, thinkingPref);
      setInput('');
      return;
    }
    if (prompt === '/thinking') {
      const next = thinkingPref === 'show' ? 'hide' : 'show';
      setThinkingPref(next);
      persistPrefs(mode, next);
      setInput('');
      return;
    }
    setInput('');
    const entry: Entry = { id: nextId.current++, prompt, status: 'pending' };
    setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry]);
    setBusy(true);
    setLive({ stage: 'signature' });
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
      const result = await engine.pipeline.ask(prompt, {
        systemPrompt: mode === 'plan' ? PLAN_INSTRUCTION : undefined,
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

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <MugilLogo />
      </Box>
      <Header config={config} mode={mode} thinkingPref={thinkingPref} />
      {busy && <LiveStatusLine status={live} spinner={spinner} />}
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} spinner={spinner} thinkingPref={thinkingPref} />
        ))}
      </Box>
      <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder={busy ? spinner : `type a prompt, or /plan · /act · /thinking · /quit`}
        />
      </Box>
    </Box>
  );
}

function Header({
  config,
  mode,
  thinkingPref,
}: {
  config: Engine['config'];
  mode: Mode;
  thinkingPref: ThinkingPref;
}): React.ReactElement {
  const backendName = config.redisUrl ? 'redis' : config.cacheDir ? 'file' : 'memory';
  const liveMode = config.provider === 'openrouter' ? 'openrouter' : config.provider;
  const keySet =
    config.openRouterApiKey || config.openaiApiKey || config.anthropicApiKey ? 'live' : 'mock';
  return (
    <Box flexDirection="column">
      <Text bold color="green">
        ⚡ {BRAND}
      </Text>
      <Text dimColor>
        mode: <Text color={mode === 'plan' ? 'yellow' : 'green'}>{MODE_LABEL[mode]}</Text>
        {' · '}thinking: <Text color={thinkingPref === 'show' ? 'yellow' : 'gray'}>{thinkingPref}</Text>
        {' · '}provider: {liveMode} ({keySet}) · model: {config.models.map((m) => m.id).join(' → ')} ·
        cache: {backendName} (TTL {config.cacheTtlSeconds}s) · budget: {config.tokenBudget} tokens
      </Text>
    </Box>
  );
}

function LiveStatusLine({ status, spinner }: { status: LiveStatus; spinner: string }): React.ReactElement {
  const parts = [
    status.stage && `stage: ${status.stage}`,
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
