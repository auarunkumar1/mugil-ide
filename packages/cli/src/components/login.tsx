import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { BRAND, writeUserEnv } from '@mugil-ide/core';

export interface ProviderInfo {
  id: string;
  label: string;
  signup: string;
  keyVar: string;
  modelsVar: string;
  baseVar: string;
  custom?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter (primary)',
    signup: 'https://openrouter.ai/keys',
    keyVar: 'OPENROUTER_API_KEY',
    modelsVar: 'OPENROUTER_MODELS',
    baseVar: 'OPENROUTER_BASE_URL',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    signup: 'https://platform.openai.com/api-keys',
    keyVar: 'OPENAI_API_KEY',
    modelsVar: 'OPENAI_MODELS',
    baseVar: 'OPENAI_BASE_URL',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    signup: 'https://console.anthropic.com/settings/keys',
    keyVar: 'ANTHROPIC_API_KEY',
    modelsVar: 'ANTHROPIC_MODELS',
    baseVar: 'ANTHROPIC_BASE_URL',
  },
  {
    id: 'openai-custom',
    label: 'OpenAI-compatible endpoint (custom base URL)',
    signup: '',
    keyVar: 'OPENAI_API_KEY',
    modelsVar: 'OPENAI_MODELS',
    baseVar: 'OPENAI_BASE_URL',
    custom: true,
  },
  {
    id: 'anthropic-custom',
    label: 'Anthropic-compatible endpoint (custom base URL)',
    signup: '',
    keyVar: 'ANTHROPIC_API_KEY',
    modelsVar: 'ANTHROPIC_MODELS',
    baseVar: 'ANTHROPIC_BASE_URL',
    custom: true,
  },
];

export function providerById(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Masks a key for display: prefix + •••• + last 4 chars. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export interface LoginResult {
  ok: boolean;
  provider?: string;
  file?: string;
  error?: string;
}

type Step = 'provider' | 'baseUrl' | 'key' | 'models' | 'done';

interface LoginWizardProps {
  initialProvider?: string;
  onDone: (result: LoginResult) => void;
}

const KEY_HINT = 'key is saved to your user env file — it is never echoed or committed';

export function LoginWizard({ initialProvider, onDone }: LoginWizardProps): React.ReactElement {
  useApp();
  const [step, setStep] = useState<Step>(initialProvider ? 'key' : 'provider');
  const [provider, setProvider] = useState<ProviderInfo | undefined>(
    initialProvider ? providerById(initialProvider) : undefined,
  );
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const finished = useRef(false);
  const finish = (result: LoginResult): void => {
    if (finished.current) return;
    finished.current = true;
    onDone(result);
  };
  useEffect(() => () => finish({ ok: false, error: 'cancelled' }), []);

  function chooseProvider(raw: string): void {
    const id = raw.trim().toLowerCase();
    const match = providerById(id) ?? PROVIDERS[Number(id) - 1];
    if (!match) {
      setError(`unknown provider "${raw}" — pick a number or name`);
      return;
    }
    setError(undefined);
    setProvider(match);
    setStep(match.custom ? 'baseUrl' : 'key');
  }

  function submitBaseUrl(raw: string): void {
    const url = raw.trim();
    if (!/^https?:\/\//.test(url)) {
      setError('base URL must start with http:// or https://');
      return;
    }
    setError(undefined);
    setBaseUrl(url);
    setStep('key');
  }

  function submitKey(raw: string): void {
    const value = raw.trim();
    if (!value) {
      setError('API key must not be empty');
      return;
    }
    setError(undefined);
    setKey(value);
    setStep('models');
  }

  function submitModels(raw: string): void {
    const ladder = raw.trim();
    setError(undefined);
    setBusy(true);
    try {
      const entries: Record<string, string> = { [provider!.keyVar]: key.trim() };
      if (baseUrl) entries[provider!.baseVar] = baseUrl;
      if (ladder) entries[provider!.modelsVar] = ladder;
      const file = writeUserEnv(entries);
      setStep('done');
      finish({ ok: true, provider: provider!.id, file });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="green">
        ⚡ {BRAND} — provider login
      </Text>

      {step === 'provider' && (
        <>
          <Text dimColor>Choose a provider (register there first, then paste the API key):</Text>
          {PROVIDERS.map((p, i) => (
            <Text key={p.id}>
              {'  '}
              <Text color="cyan">{i + 1}</Text> {p.label}
            </Text>
          ))}
          <Prompt label="provider" onSubmit={chooseProvider} />
        </>
      )}

      {step === 'baseUrl' && (
        <>
          <Text dimColor>
            {provider!.label} — enter the endpoint base URL (chat-completions style, e.g.
            https://api.example.com/v1)
          </Text>
          <Prompt label="base URL" onSubmit={submitBaseUrl} />
        </>
      )}

      {step === 'key' && (
        <>
          {provider!.signup ? (
            <Text dimColor>
              Register at <Text color="cyan">{provider!.signup}</Text>, then paste your API key below
              ({KEY_HINT}).
            </Text>
          ) : (
            <Text dimColor>Paste your API key below ({KEY_HINT}).</Text>
          )}
          <Prompt label="API key" onSubmit={submitKey} mask="•" />
        </>
      )}

      {step === 'models' && (
        <>
          <Text dimColor>
            Model ladder (comma-separated, cheap → smart) — optional, Enter for the default:
          </Text>
          <Prompt label="models" onSubmit={submitModels} placeholder="e.g. gpt-4o-mini,gpt-4o" />
        </>
      )}

      {step === 'done' && <Text color="green">✓ saved.</Text>}
      {busy && <Text dimColor>saving…</Text>}
      {error && <Text color="red">✗ {error}</Text>}
      <Text dimColor>Ctrl+C to cancel</Text>
    </Box>
  );
}

function Prompt({
  label,
  onSubmit,
  mask,
  placeholder,
}: {
  label: string;
  onSubmit: (value: string) => void;
  mask?: string;
  placeholder?: string;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan">❯ {label}: </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        mask={mask}
        placeholder={placeholder}
      />
    </Box>
  );
}
