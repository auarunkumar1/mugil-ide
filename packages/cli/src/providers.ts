/**
 * Provider definitions + key-masking helpers, shared by the `keys` CLI
 * command and the `GET /api/keys` web endpoint. (Formerly lived in the
 * retired `loginCli.ts` wizard.)
 */
export interface ProviderDef {
  id: string;
  label: string;
  keyVar: string;
  baseVar?: string;
  url: string;
  custom?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter (recommended — 200+ models, cheap fallback)',
    keyVar: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT-4o, o1, o3-mini)',
    keyVar: 'OPENAI_API_KEY',
    url: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude 3.5 Sonnet, Claude 3.7 Sonnet)',
    keyVar: 'ANTHROPIC_API_KEY',
    url: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (Local LLM — no API key required)',
    keyVar: 'OLLAMA_BASE_URL',
    url: 'http://localhost:11434/v1',
    custom: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (Local LLM — no API key required)',
    keyVar: 'LMSTUDIO_BASE_URL',
    url: 'http://localhost:1234/v1',
    custom: true,
  },
  {
    id: 'openai-custom',
    label: 'OpenAI Compatible (Local/Self-hosted endpoint)',
    keyVar: 'OPENAI_API_KEY',
    baseVar: 'OPENAI_BASE_URL',
    url: 'https://api.openai.com/v1',
    custom: true,
  },
];

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function maskKey(k: string): string {
  if (!k) return '(not set)';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '…' + k.slice(-4);
}
