import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  BRAND,
  readUserEnv,
  writeUserEnv,
  fetchProviderModels,
  type AppConfig,
} from '@mugil-ide/core';
import { PROVIDERS, maskKey, type ProviderInfo } from './login.js';

export interface AccountsMenuProps {
  config: AppConfig;
  onClose: () => void;
  onKeyUpdated: () => void;
}

type MenuMode = 'list' | 'inputKey' | 'inputBaseUrl' | 'inputPort' | 'probing' | 'success';

export function AccountsMenu({
  config,
  onClose,
  onKeyUpdated,
}: AccountsMenuProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<MenuMode>('list');
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | undefined>();
  const [keyInput, setKeyInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [portInput, setPortInput] = useState('');
  const [message, setMessage] = useState<string | undefined>();
  const [isError, setIsError] = useState(false);

  const env = readUserEnv();

  const menuItems = [
    ...PROVIDERS.map((p) => {
      const isConnected =
        config.provider === p.id ||
        Boolean(env[p.keyVar]) ||
        (p.id === 'openrouter' && Boolean(config.openRouterApiKey)) ||
        (p.id === 'openai' && Boolean(config.openaiApiKey)) ||
        (p.id === 'anthropic' && Boolean(config.anthropicApiKey)) ||
        (p.id === 'ollama' && config.provider === 'ollama') ||
        (p.id === 'lmstudio' && config.provider === 'lmstudio') ||
        (p.id === 'local' && config.provider === 'local');

      const val = env[p.keyVar] || (p.id === 'openrouter' ? config.openRouterApiKey : p.id === 'openai' ? config.openaiApiKey : p.id === 'anthropic' ? config.anthropicApiKey : undefined);
      const url = env[p.baseVar] || (p.id === 'ollama' ? config.ollamaBaseUrl : p.id === 'lmstudio' ? config.lmstudioBaseUrl : p.id === 'local' ? config.localBaseUrl : undefined);

      return {
        provider: p,
        configured: isConnected,
        masked: p.isLocal
          ? url || p.defaultBaseUrl || 'Connected'
          : val
            ? maskKey(val)
            : 'Not configured',
      };
    }),
    {
      provider: {
        id: 'back',
        label: '← Back to Chat',
        signup: '',
        keyVar: '',
        modelsVar: '',
        baseVar: '',
      },
      configured: false,
      masked: '',
    },
  ];

  useInput((input, key) => {
    if (mode !== 'list') {
      if (key.escape || (mode === 'success' && key.return)) {
        setMode('list');
        setMessage(undefined);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : menuItems.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < menuItems.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const item = menuItems[selectedIndex];
      if (!item || item.provider.id === 'back') {
        onClose();
        return;
      }
      setSelectedProvider(item.provider);
      setKeyInput('');
      setBaseUrlInput('');
      setPortInput(item.provider.defaultPort || '');
      setMessage(undefined);
      setIsError(false);

      if (item.provider.isLocal) {
        setMode('inputPort');
      } else if (item.provider.custom) {
        setMode('inputBaseUrl');
      } else {
        setMode('inputKey');
      }
    } else if (key.escape || input === 'q') {
      onClose();
    }
  });

  function handleKeySubmit(raw: string): void {
    const val = raw.trim();
    if (!val) {
      setMessage('API key cannot be empty');
      setIsError(true);
      return;
    }
    if (!selectedProvider) return;

    try {
      const entries: Record<string, string> = {
        [selectedProvider.keyVar]: val,
        AI_PROVIDER: selectedProvider.id,
      };
      if (baseUrlInput) {
        entries[selectedProvider.baseVar] = baseUrlInput;
      }
      writeUserEnv(entries);
      for (const [k, v] of Object.entries(entries)) {
        process.env[k] = v;
      }
      onKeyUpdated();
      setMessage(`✓ ${selectedProvider.label} API key saved! (Active provider: ${selectedProvider.id})`);
      setIsError(false);
      setMode('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setIsError(true);
    }
  }

  function handleBaseUrlSubmit(raw: string): void {
    const url = raw.trim();
    if (!/^https?:\/\//.test(url)) {
      setMessage('Base URL must start with http:// or https://');
      setIsError(true);
      return;
    }
    setBaseUrlInput(url);
    setMode('inputKey');
    setMessage(undefined);
  }

  async function handlePortSubmit(raw: string): Promise<void> {
    if (!selectedProvider) return;
    const trimmed = raw.trim();
    let endpoint = selectedProvider.defaultBaseUrl || 'http://localhost:11434/v1';

    if (trimmed) {
      if (/^\d+$/.test(trimmed)) {
        endpoint = `http://localhost:${trimmed}/v1`;
      } else if (/^https?:\/\//.test(trimmed)) {
        endpoint = trimmed.endsWith('/v1') ? trimmed : `${trimmed.replace(/\/+$/, '')}/v1`;
      } else {
        endpoint = `http://localhost:${trimmed}/v1`;
      }
    }

    setMode('probing');
    setMessage(`Probing ${selectedProvider.label} at ${endpoint}…`);

    try {
      const entries: Record<string, string> = {
        AI_PROVIDER: selectedProvider.id,
        [selectedProvider.baseVar]: endpoint,
        [selectedProvider.keyVar]: 'local',
      };
      writeUserEnv(entries);
      for (const [k, v] of Object.entries(entries)) {
        process.env[k] = v;
      }
      onKeyUpdated();

      const discovered = await fetchProviderModels({
        provider: selectedProvider.id as any,
        baseUrl: endpoint,
        timeoutMs: 4000,
      });

      if (discovered.length > 0) {
        const top = discovered.slice(0, 4).map((m) => m.id).join(', ');
        const modelNames = discovered.map((m) => m.id).join(',');
        const modelsVar = selectedProvider.modelsVar || 'OLLAMA_MODELS';
        process.env[modelsVar] = modelNames;
        writeUserEnv({ [modelsVar]: modelNames });
        onKeyUpdated();
        setMessage(
          `✓ Connected to ${selectedProvider.label} at ${endpoint}!\nDiscovered ${discovered.length} model(s): ${top}${discovered.length > 4 ? '…' : ''}`,
        );
      } else {
        setMessage(
          `✓ Saved ${selectedProvider.label} at ${endpoint}.\n(Server reachable, select model with /model)`,
        );
      }
      setIsError(false);
      setMode('success');
    } catch {
      setMessage(`✓ Saved ${selectedProvider.label} endpoint (${endpoint}).`);
      setIsError(false);
      setMode('success');
    }
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={1}
      paddingY={0}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="green">
          ⚡ {BRAND} — Accounts & Local AI Provider Setup
        </Text>
      </Box>

      {mode === 'list' && (
        <>
          <Text dimColor>
            Select a provider or local AI engine to connect:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {menuItems.map((item, i) => {
              const isSelected = i === selectedIndex;
              if (item.provider.id === 'back') {
                return (
                  <Box key="back" marginTop={1}>
                    <Text color={isSelected ? 'yellow' : 'gray'} bold={isSelected}>
                      {isSelected ? '❯ ' : '  '}
                      {item.provider.label}
                    </Text>
                  </Box>
                );
              }
              return (
                <Box key={item.provider.id} flexDirection="column" marginBottom={0}>
                  <Box>
                    <Text color={isSelected ? 'green' : 'white'} bold={isSelected}>
                      {isSelected ? '❯ ' : '  '}
                      {item.provider.label.padEnd(36)}
                    </Text>
                    <Text color={item.configured ? 'green' : 'gray'}>
                      {item.configured ? `[Connected: ${item.masked}]` : '[Not Configured]'}
                    </Text>
                  </Box>
                  {isSelected && item.provider.signup && (
                    <Box paddingLeft={4}>
                      <Text dimColor>
                        URL: <Text color="cyan">{item.provider.signup}</Text>
                      </Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
          <Text dimColor>Use ↑/↓ to navigate, Enter to select, Esc to return to chat</Text>
        </>
      )}

      {mode === 'inputPort' && selectedProvider && (
        <Box flexDirection="column">
          <Text color="cyan" bold>
            Connect {selectedProvider.label}:
          </Text>
          <Text dimColor>
            Default endpoint: <Text color="green">{selectedProvider.defaultBaseUrl}</Text> (port {selectedProvider.defaultPort})
          </Text>
          <Text dimColor>
            Press Enter to use default port, or type custom port / host URL:
          </Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text color="cyan">❯ Port / URL: </Text>
            <TextInput
              value={portInput}
              onChange={setPortInput}
              onSubmit={handlePortSubmit}
              placeholder={selectedProvider.defaultPort || '11434'}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to connect, Esc to go back</Text>
          </Box>
        </Box>
      )}

      {mode === 'inputBaseUrl' && selectedProvider && (
        <Box flexDirection="column">
          <Text color="cyan">
            Enter endpoint base URL for {selectedProvider.label}:
          </Text>
          <Text dimColor>(e.g. https://api.openai.com/v1 or local proxy endpoint)</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text color="cyan">❯ base URL: </Text>
            <TextInput
              value={baseUrlInput}
              onChange={setBaseUrlInput}
              onSubmit={handleBaseUrlSubmit}
              placeholder="https://..."
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to confirm, Esc to go back</Text>
          </Box>
        </Box>
      )}

      {mode === 'inputKey' && selectedProvider && (
        <Box flexDirection="column">
          <Text color="green" bold>
            Enter API Key for {selectedProvider.label}:
          </Text>
          {selectedProvider.signup && (
            <Text dimColor>
              Get a key at <Text color="cyan">{selectedProvider.signup}</Text>
            </Text>
          )}
          <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
            <Text color="green">❯ API Key: </Text>
            <TextInput
              value={keyInput}
              onChange={setKeyInput}
              onSubmit={handleKeySubmit}
              mask="•"
              placeholder="paste key here..."
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Saved locally to user env file. Press Enter to save, Esc to go back.
            </Text>
          </Box>
        </Box>
      )}

      {mode === 'probing' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="yellow">⏳ {message}</Text>
        </Box>
      )}

      {mode === 'success' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="green" bold>{message}</Text>
          <Box marginTop={1}>
            <Text color="cyan">Press Enter or Esc to return to accounts list.</Text>
          </Box>
        </Box>
      )}

      {message && mode !== 'success' && mode !== 'probing' && (
        <Box marginTop={1}>
          <Text color={isError ? 'red' : 'green'}>{message}</Text>
        </Box>
      )}
    </Box>
  );
}
