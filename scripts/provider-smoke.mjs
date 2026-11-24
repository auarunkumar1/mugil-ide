#!/usr/bin/env node
/**
 * Provider Smoke Test Suite (Opt-in)
 * ===================================
 * Runs live network smoke checks against OpenCode and OpenRouter.
 * Only executes when MUGIL_IDE_LIVE_PROVIDER_TESTS=1 is explicitly set.
 * Automatically loads ~/.config/mugil-ide/.env and .env if present.
 * Never logs or prints secrets.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore missing or unreadable env files
  }
}

loadEnvFile(path.join(os.homedir(), '.config', 'mugil-ide', '.env'));
loadEnvFile(path.join(process.cwd(), '.env'));

if (!process.env.MUGIL_IDE_LIVE_PROVIDER_TESTS) {
  console.log('Skipping live provider smoke test: MUGIL_IDE_LIVE_PROVIDER_TESTS is not set.');
  process.exit(0);
}

console.log('Running live provider smoke tests...');

async function testOpenCode(opencodeKey) {
  console.log('Testing OpenCode usage and plan resolution...');
  try {
    const res = await fetch('https://opencode.ai/inference/go/v1/usage', {
      headers: { Authorization: `Bearer ${opencodeKey}` },
      signal: globalThis.AbortSignal.timeout(8000),
    });
    console.log(`OpenCode usage check returned HTTP ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      const isGo = Boolean(data?.usage?.rolling || data?.plan === 'go');
      console.log(`OpenCode plan detection: ${isGo ? 'Go subscription detected' : 'Zen / Pay-as-you-go'}`);
    }

    console.log('Testing OpenCode minimal completion...');
    const compRes = await fetch('https://opencode.ai/inference/go/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opencodeKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'mugil-ide/0.6.0',
        'x-opencode-session': `ses_smoke_${Date.now().toString(36)}`,
      },
      body: JSON.stringify({
        model: 'beam-free',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 32,
      }),
      signal: globalThis.AbortSignal.timeout(10000),
    });
    console.log(`OpenCode completion returned HTTP ${compRes.status}`);
    if (!compRes.ok) {
      throw new Error(`OpenCode completion failed with HTTP ${compRes.status}`);
    }

    const session = `ses_smoke_${Date.now().toString(36)}`;
    const messagesRes = await fetch(
      'https://opencode.ai/inference/go/anthropic/v1/messages',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opencodeKey}`,
          'x-api-key': opencodeKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'User-Agent': 'mugil-ide/0.6.0',
          'x-opencode-session': session,
        },
        body: JSON.stringify({
          model: 'claude-haiku-5-5',
          max_tokens: 32,
          messages: [{ role: 'user', content: 'Reply OK' }],
        }),
        signal: globalThis.AbortSignal.timeout(20000),
      },
    );
    console.log(`OpenCode Messages completion returned HTTP ${messagesRes.status}`);
    if (!messagesRes.ok) {
      throw new Error(`OpenCode Messages completion failed with HTTP ${messagesRes.status}`);
    }

    const responsesRes = await fetch(
      'https://opencode.ai/inference/go/openai/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opencodeKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'mugil-ide/0.6.0',
          'x-opencode-session': session,
        },
        body: JSON.stringify({
          model: 'gpt-6-luna',
          max_output_tokens: 32,
          input: [{ role: 'user', content: 'Reply OK' }],
        }),
        signal: globalThis.AbortSignal.timeout(20000),
      },
    );
    console.log(`OpenCode Responses completion returned HTTP ${responsesRes.status}`);
    if (!responsesRes.ok) {
      throw new Error(`OpenCode Responses completion failed with HTTP ${responsesRes.status}`);
    }
    const responsesJson = await responsesRes.json();
    const outputText = Array.isArray(responsesJson.output)
      ? responsesJson.output
          .filter((item) => item?.type === 'message')
          .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
          .filter((part) => part?.type === 'output_text')
          .map((part) => part.text)
          .join('')
      : '';
    if (!outputText) {
      throw new Error('OpenCode Responses completion returned no output_text');
    }
  } catch (err) {
    console.error('OpenCode test failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function testOpenRouter(openrouterKey) {
  console.log('Testing OpenRouter models endpoint...');
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${openrouterKey}` },
      signal: globalThis.AbortSignal.timeout(8000),
    });
    console.log(`OpenRouter models check returned HTTP ${res.status}`);

    console.log('Testing OpenRouter minimal completion...');
    const compRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/auarunkumar1/mugil-ide',
        'X-Title': 'Mugil IDE',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 32,
      }),
      signal: globalThis.AbortSignal.timeout(10000),
    });
    console.log(`OpenRouter completion returned HTTP ${compRes.status}`);
    if (!compRes.ok) {
      throw new Error(`OpenRouter completion failed with HTTP ${compRes.status}`);
    }
  } catch (err) {
    console.error('OpenRouter test failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function main() {
  const opencodeKey = process.env.OPENCODE_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (opencodeKey) {
    await testOpenCode(opencodeKey);
  } else {
    console.log('OPENCODE_API_KEY not configured, skipping OpenCode check.');
  }

  if (openrouterKey) {
    await testOpenRouter(openrouterKey);
  } else {
    console.log('OPENROUTER_API_KEY not configured, skipping OpenRouter check.');
  }

  console.log('Provider smoke test complete.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
