import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { BRAND, type Engine, type AskResult } from '@mugil-ide/core';
import { MugilLogo } from './logo.js';

interface Entry {
  id: number;
  prompt: string;
  status: 'pending' | 'done' | 'error';
  result?: AskResult;
  error?: string;
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
  const nextId = React.useRef(1);

  const { config } = engine;

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
    setInput('');
    const entry: Entry = { id: nextId.current++, prompt, status: 'pending' };
    setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry]);
    setBusy(true);
    try {
      const result = await engine.pipeline.ask(prompt);
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
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <MugilLogo />
      </Box>
      <Header config={config} />
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} />
        ))}
      </Box>
      <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder={busy ? 'working…' : 'type a prompt, or /quit'}
        />
      </Box>
    </Box>
  );
}

function Header({ config }: { config: Engine['config'] }): React.ReactElement {
  const backendName = config.redisUrl ? 'redis' : config.cacheDir ? 'file' : 'memory';
  const mode = config.openRouterApiKey ? 'live' : 'mock';
  return (
    <Box flexDirection="column">
      <Text bold color="green">
        ⚡ {BRAND}
      </Text>
      <Text dimColor>
        model: {config.models.map((m) => m.id).join(' → ')} · cache: {backendName} (TTL{' '}
        {config.cacheTtlSeconds}s) · mode: {mode} · budget: {config.tokenBudget} tokens
      </Text>
    </Box>
  );
}

function EntryView({ entry }: { entry: Entry }): React.ReactElement | null {
  if (entry.status === 'pending') {
    return (
      <Box>
        <Text dimColor>⏳ {entry.prompt.slice(0, 60)}…</Text>
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
      </Text>
      <Text color="gray">{r.response}</Text>
    </Box>
  );
}
