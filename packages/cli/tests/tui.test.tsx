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

function stubEngine(result: AskResult = BASE_RESULT): { engine: Engine; ask: jest.Mock } {
  const ask = jest.fn().mockResolvedValue(result);
  const engine = {
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
  return { engine, ask };
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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300));

describe('ChatApp (TUI)', () => {
  it('renders the logo and header with default prefs', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    const frame = app.lastFrame();
    expect(frame).toContain('Mugil IDE');
    expect(frame).toContain('mode: act');
    expect(frame).toContain('thinking: hide');
    expect(frame).toContain('provider: openrouter (mock)');
    app.unmount();
  });

  it('reads persisted prefs from the user env file', async () => {
    writeFileSync(envFile, 'MUGIL_IDE_TUI_MODE=plan\nMUGIL_IDE_TUI_THINKING=show\n');
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    const frame = app.lastFrame();
    expect(frame).toContain('mode: plan');
    expect(frame).toContain('thinking: show');
    app.unmount();
  });

  it('/plan toggles mode and persists it', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/plan\r');
    await flush();
    expect(app.lastFrame()).toContain('mode: plan');
    expect(readFileSync(envFile, 'utf8')).toContain('MUGIL_IDE_TUI_MODE=plan');
    app.unmount();
  });

  it('/thinking toggles and persists the preference', async () => {
    const { engine } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/thinking\r');
    await flush();
    expect(app.lastFrame()).toContain('thinking: show');
    expect(readFileSync(envFile, 'utf8')).toContain('MUGIL_IDE_TUI_THINKING=show');
    app.unmount();
  });

  it('submitting a prompt calls pipeline.ask and shows the response', async () => {
    const { engine, ask } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('fix the bug\r');
    await flush();
    expect(ask).toHaveBeenCalledWith('fix the bug', expect.objectContaining({ systemPrompt: undefined }));
    expect(app.lastFrame()).toContain('hello from mock');
    expect(app.lastFrame()).toContain('-0%');
    app.unmount();
  });

  it('plan mode sends the plan instruction to the model', async () => {
    const { engine, ask } = stubEngine();
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/plan\r');
    await flush();
    app.stdin.write('write a parser\r');
    await flush();
    expect(ask).toHaveBeenCalledWith(
      'write a parser',
      expect.objectContaining({ systemPrompt: expect.stringContaining('PLAN mode') }),
    );
    app.unmount();
  });

  it('shows the thinking block when enabled and present', async () => {
    const { engine } = stubEngine({ ...BASE_RESULT, thinking: 'step 1: think about inputs' });
    const app = await renderApp(React.createElement(ChatApp, { engine, onExit: () => {} }));
    app.stdin.write('/thinking\r');
    await flush();
    app.stdin.write('deep question\r');
    await flush();
    const frame = app.lastFrame();
    expect(frame).toContain('💭 thinking');
    expect(frame).toContain('step 1: think about inputs');
    expect(frame).toContain('hello from mock');
    app.unmount();
  });
});
