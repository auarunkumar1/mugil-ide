import React from 'react';
import { jest } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatApp } from '../src/components/app.js';
import { renderApp } from './helpers/renderApp.js';
import type { AskResult, Engine } from '@mugil-ide/core';

const BASE_RESULT: AskResult = {
  response: 'hello from mock',
  model: 'openrouter/auto',
  provider: 'mock',
  mock: true,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  refine: {
    original: 'fix the bug',
    refined: 'fix the bug',
    originalTokens: 10,
    refinedTokens: 10,
    savingsPct: 0,
    appliedStrategies: [],
  },
  cache: { hit: false },
  thinking: undefined,
};

function stubEngine(result: AskResult = BASE_RESULT): { engine: Engine; ask: jest.Mock; clear: jest.Mock } {
  const ask = jest.fn().mockResolvedValue(result);
  const clear = jest.fn().mockResolvedValue(undefined);
  const engine = {
    cache: { clear },
    config: {
      provider: 'openrouter' as const,
      openRouterApiKey: undefined,
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      openaiApiKey: undefined,
      openaiBaseUrl: 'https://api.openai.com/v1',
      anthropicApiKey: undefined,
      anthropicBaseUrl: 'https://api.anthropic.com',
      redisUrl: undefined,
      redisClusterUrls: [],
      cacheDir: undefined,
      nodeEnv: 'test',
      aiDebug: false,
      tokenBudget: 10000,
      cacheTtlSeconds: 3600,
      models: [
        { id: 'openrouter/auto', tier: 'cheap' as const, costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 },
      ],
      embedding: {},
    },
    pipeline: { ask },
  } as unknown as Engine;
  return { engine, ask, clear };
}

let envFile = '';

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'mugil-tui-'));
  envFile = join(dir, '.env');
  process.env.MUGIL_IDE_ENV_FILE = envFile;
});

afterEach(() => {
  delete process.env.MUGIL_IDE_ENV_FILE;
  rmSync(join(envFile, '..'), { recursive: true, force: true });
});

async function waitFor(fn: () => void | Promise<void>, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      await fn();
      return;
    } catch (err) {
      if (Date.now() - started > timeoutMs) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('ChatApp (TUI)', () => {
  it('renders the logo and header with default prefs', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    const frame = app.lastFrame();
    expect(frame).toContain('Mugil IDE');
    expect(frame).toContain('mode: act');
    expect(frame).toContain('view: hide');
    expect(frame).toContain('provider: openrouter (mock)');
    app.unmount();
  });

  it('reads persisted prefs from the user env file', async () => {
    writeFileSync(envFile, 'MUGIL_IDE_TUI_MODE=plan\nMUGIL_IDE_TUI_THINKING=show\n');
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    const frame = app.lastFrame();
    expect(frame).toContain('mode: plan');
    expect(frame).toContain('view: show');
    app.unmount();
  });

  it('/plan toggles mode and persists it', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/plan\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('mode: plan');
      expect(readFileSync(envFile, 'utf8')).toContain('MUGIL_IDE_TUI_MODE=plan');
    });
    app.unmount();
  });

  it('/thinking-view toggles and persists the preference', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/thinking-view\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('view: show');
      expect(readFileSync(envFile, 'utf8')).toContain('MUGIL_IDE_TUI_THINKING=show');
    });
    app.unmount();
  });

  it('/model opens the model selection dropdown', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/model\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('Select Active Model');
    });
    app.unmount();
  });

  it('selecting a model with Enter returns to chat and keeps input working', async () => {
    const { engine, ask } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    // Have a conversation first (the reported break happened mid-conversation).
    app.stdin.write('first question\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('hello from mock');
    });
    // Open /model and immediately press Enter on the highlighted model.
    app.stdin.write('/model\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('Select Active Model');
    });
    app.stdin.write('\r');
    await waitFor(() => {
      expect(app.lastFrame()).not.toContain('Select Active Model');
    });
    // The chat input must be back (not the custom-model screen), so the next
    // prompt goes to the model, not into the model-name field.
    await waitFor(() => {
      expect(app.lastFrame()).not.toContain('Enter Custom Model ID');
    });
    app.stdin.write('second question\r');
    await waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(2);
    });
    app.unmount();
  });

  it('arrow keys in the dropdown do not wrap onto the custom-model entry', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/model\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('Select Active Model');
    });
    // Down + Enter while the catalog is still the small default list: the
    // cursor must clamp (not wrap to the custom entry) and select a real model.
    app.stdin.write('\u001B[B\r');
    await waitFor(() => {
      expect(app.lastFrame()).not.toContain('Select Active Model');
    });
    await waitFor(() => {
      expect(app.lastFrame()).not.toContain('Enter Custom Model ID');
    });
    app.unmount();
  });

  it('/thinking opens the thinking level dropdown', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/thinking\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('Select Thinking Level');
      expect(app.lastFrame()).toContain('High — Deep reasoning');
    });
    app.unmount();
  });

  it('/accounts opens the accounts menu', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/accounts\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('Accounts & Local AI Provider Setup');
      expect(app.lastFrame()).toContain('OpenRouter');
    });
    app.unmount();
  });

  it('submitting a prompt calls pipeline.ask and shows the response', async () => {
    const { engine, ask } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('fix the bug\r');
    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith(
        'fix the bug',
        expect.objectContaining({ preferredModel: 'openrouter/auto' }),
      );
      expect(app.lastFrame()).toContain('hello from mock');
      expect(app.lastFrame()).toContain('-0%');
    });
    app.unmount();
  });

  it('plan mode sends the plan instruction to the model', async () => {
    const { engine, ask } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/plan\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('mode: plan');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    app.stdin.write('write a parser\r');
    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith(
        'write a parser',
        expect.objectContaining({ systemPrompt: expect.stringContaining('PLAN mode') }),
      );
    });
    app.unmount();
  });

  it('/clear-cache actually purges the cache and shows confirmation', async () => {
    const { engine, clear } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/clear-cache\r');
    await waitFor(() => {
      expect(clear).toHaveBeenCalled();
      expect(app.lastFrame()).toContain('Cache purged successfully');
    });
    app.unmount();
  });

  it('shows the thinking block when enabled and present', async () => {
    const { engine } = stubEngine({ ...BASE_RESULT, thinking: 'step 1: think about inputs' });
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/thinking-view\r');
    await waitFor(() => {
      expect(app.lastFrame()).toContain('view: show');
    });
    app.stdin.write('deep question\r');
    await waitFor(() => {
      const frame = app.lastFrame();
      expect(frame).toContain('💭 thinking');
      expect(frame).toContain('step 1: think about inputs');
      expect(frame).toContain('hello from mock');
    });
    app.unmount();
  });
});
