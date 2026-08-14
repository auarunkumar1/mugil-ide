#!/usr/bin/env node
import 'dotenv/config';
import { statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import {
  createEngine,
  deleteUserEnvKeys,
  loadConfig,
  readUserEnv,
  userEnvPath,
} from '@mugil-ide/core';
import { ChatApp } from './components/app.js';
import { LoginWizard, PROVIDERS, maskKey, providerById, type LoginResult } from './components/login.js';
import { runOnce } from './run.js';

const program = new Command();

program
  .name('mugil-ide')
  .description('Mugil IDE — token-efficient AI IDE: refines prompts, caches aggressively, hands off models automatically.')
  .version('1.0.0');

program
  .command('run')
  .description('Run a single prompt and print the result')
  .argument('[prompt...]', 'prompt text')
  .option('-m, --model <id>', 'preferred model id')
  .option('-b, --budget <tokens>', 'token budget for refinement')
  .option('--json', 'output raw JSON')
  .option('--no-refine', 'skip token refinement')
  .option('--no-cache', 'skip the cache')
  .option('--no-ponytail', 'disable output minimization')
  .option('--output-budget <tokens>', 'cap completion tokens (ponytail)')
  .action(async (promptParts: string[], options: Record<string, unknown>) => {
    const prompt = promptParts.join(' ');
    if (!prompt) {
      program.error('error: prompt required for "run" (e.g. mugil-ide run "write a parser")');
    }
    const engine = createEngine(loadConfig());
    await runOnce(engine, prompt, options);
    await engine.backend.close();
  });

program
  .command('update')
  .description('Check for module/package updates and apply them')
  .option('--check', 'only report; do not apply anything')
  .option('--watch', 'run the check/apply cycle periodically (implies apply)')
  .option('--interval <seconds>', 'periodic interval when --watch', '3600')
  .option('--registry <url>', 'module rules registry URL (or MUGIL_IDE_MODULES_REGISTRY)')
  .option('--no-npm', 'skip the npm package version check')
  .action(async (options: Record<string, unknown>) => {
    const { UpdateManager } = await import('@mugil-ide/core');
    const manager = new UpdateManager({
      registryUrl: typeof options.registry === 'string' ? options.registry : undefined,
      checkNpm: options.npm !== false,
      onError: (err) => console.error(`  ⚠ ${err instanceof Error ? err.message : String(err)}`),
    });
    if (options.watch) {
      const interval = Number(options.interval ?? 3600);
      console.log(`watching for updates every ${interval}s (Ctrl+C to stop)…`);
      manager.watch({
        intervalSeconds: interval,
        onUpdate: (result, applied) => {
          printUpdates(result, applied);
        },
      });
    } else {
      const result = await manager.check();
      const applied = result.updates.length > 0 && !options.check ? await manager.apply(result.updates) : [];
      printUpdates(result, applied);
    }
  });

program
  .command('graph')
  .description('Build a code knowledge graph for a project (symbols, imports, call edges) and query it for context')
  .argument('[dir]', 'project root to scan', '.')
  .option('-q, --query <text>', 'find the symbols most relevant to a task (context injection)')
  .option('-o, --output <file>', 'write the serialized graph as JSON')
  .option('--top <n>', 'number of results for --query', '10')
  .action(async (dir: string, options: { query?: string; output?: string; top?: string }) => {
    const { buildCodeGraph, queryCodeGraph } = await import('@mugil-ide/core');
    const root = path.resolve(dir);
    const graph = buildCodeGraph(root);
    if (options.query) {
      const results = queryCodeGraph(graph, options.query, { top: Number(options.top ?? 10) });
      console.log(`\n  codegraph — ${results.length} relevant symbols for "${options.query}"\n`);
      for (const { symbol, score } of results) {
        console.log(`  [${String(score).padStart(3)}] ${symbol.file}:${symbol.line}  ${symbol.signature}`);
        const head = symbol.snippet.split('\n').slice(0, 2).join(' ');
        console.log(`        ${head.slice(0, 110)}`);
      }
      console.log('');
    } else if (options.output) {
      writeFileSync(options.output, JSON.stringify(graph, null, 2));
      console.log(
        `\n  codegraph: ${graph.stats.files} files · ${graph.stats.symbols} symbols · ${graph.stats.importEdges} imports · ${graph.stats.callEdges} calls → ${options.output}\n`,
      );
    } else {
      console.log(`\n  codegraph — ${path.basename(root) || root}`);
      console.log(`  files:    ${graph.stats.files}`);
      console.log(`  symbols:  ${graph.stats.symbols}`);
      console.log(`  imports:  ${graph.stats.importEdges} edges`);
      console.log(`  calls:    ${graph.stats.callEdges} edges (same-file)`);
      console.log(
        `  languages: ${Object.entries(graph.stats.languages)
          .map(([l, n]) => `${l} (${n})`)
          .join(', ')}`,
      );
      console.log('  hint: --query "<task>" returns the relevant code for context\n');
    }
  });

program
  .command('login')
  .description('Register with a provider and save your API key safely (user env file, owner-only permissions)')
  .option('-p, --provider <name>', 'preselect provider: openrouter | openai | anthropic | openai-custom | anthropic-custom')
  .action(async (options: { provider?: string }) => {
    await runLogin(options.provider);
  });

program
  .command('logout')
  .description('Remove a saved API key for a provider (--all removes every key)')
  .argument('[provider]', 'openrouter | openai | anthropic')
  .option('--all', 'remove all saved provider keys')
  .action(async (provider: string | undefined, options: { all?: boolean }) => {
    const keyVarByProvider: Record<string, string> = {
      openrouter: 'OPENROUTER_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
    };
    const keys = options.all
      ? Object.values(keyVarByProvider)
      : provider
        ? [keyVarByProvider[provider]]
        : [];
    if (keys.length === 0 || keys.some((k) => !k)) {
      program.error('error: provide a provider (openrouter | openai | anthropic) or --all');
    }
    const { file, removed } = deleteUserEnvKeys(keys as string[]);
    if (removed.length === 0) {
      console.log(`  nothing to remove — no saved keys in ${file}`);
      return;
    }
    console.log(`  removed ${removed.join(', ')} from ${file}`);
  });

program
  .command('keys')
  .description('Show which provider API keys are configured (masked)')
  .action(() => {
    const env = readUserEnv();
    const file = userEnvPath();
    console.log(`\n  Mugil IDE API keys — ${file}\n`);
    let any = false;
    for (const p of PROVIDERS.filter((x) => !x.custom)) {
      const value = env[p.keyVar];
      if (value) {
        any = true;
        console.log(`  ${p.id.padEnd(12)} ${maskKey(value)}`);
      } else {
        console.log(`  ${p.id.padEnd(12)} — not configured`);
      }
    }
    for (const p of PROVIDERS.filter((x) => x.custom)) {
      const base = env[p.baseVar];
      if (base) console.log(`  ${p.id.padEnd(12)} base: ${base}`);
    }
    if (!any) {
      console.log('  none configured — run "mugil-ide login" to add a key');
    }
    try {
      const mode = statSync(file).mode;
      if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
        console.log(`  ⚠ ${file} is readable by others — fix with: chmod 600 "${file}"`);
      }
    } catch {
      // file absent
    }
    console.log('');
  });

program
  .command('docs')
  .description('Generate markdown documentation for a project (periodic with --watch)')
  .argument('[dir]', 'project root to scan', '.')
  .option('-o, --output <file>', 'output markdown file (default: <dir>/DOCUMENTATION.md)')
  .option('-g, --glob <pattern>', 'include glob (repeatable)', collect, [])
  .option('--watch', 'regenerate periodically')
  .option('--interval <seconds>', 'watch interval', '60')
  .action(async (dir: string, options: Record<string, unknown>) => {
    const { generateDocs, watchDocs } = await import('@mugil-ide/docs');
    const docsOptions = {
      root: dir,
      output: typeof options.output === 'string' ? options.output : undefined,
      globs: (options.glob as string[]).length > 0 ? (options.glob as string[]) : undefined,
    };
    const report = (result: { output: string; filesScanned: number; symbols: number; tokens: number }): void => {
      console.log(
        `\n  docs: ${result.output}\n  files: ${result.filesScanned} · symbols: ${result.symbols} · ~${result.tokens} tokens\n`,
      );
    };
    if (options.watch) {
      const interval = Number(options.interval ?? 60);
      console.log(`Mugil IDE docs: watching ${dir} — regenerating every ${interval}s (Ctrl+C to stop)`);
      watchDocs({ ...docsOptions, intervalSeconds: interval, onGenerated: report });
    } else {
      report(await generateDocs(docsOptions));
    }
  });

program.action(() => {
  void interactive();
});

function printUpdates(
  result: { configured: boolean; registryUrl?: string; updates: Array<{ id: string; current: string; latest: string; applied?: boolean }>; npm: { current: string; latest: string } | null },
  applied: Array<{ id: string; applied?: boolean }>,
): void {
  console.log('');
  if (result.updates.length === 0 && !result.npm) {
    console.log('  ✓ everything is up to date');
  }
  for (const update of result.updates) {
    const wasApplied = applied.some((a) => a.id === update.id && a.applied);
    console.log(`  module  ${update.id.padEnd(18)} ${update.current} -> ${update.latest}  ${wasApplied ? '✓ applied' : 'available'}`);
  }
  if (result.npm) {
    console.log(`  package ${'mugil-ide'.padEnd(18)} ${result.npm.current} -> ${result.npm.latest}  (npm i -g mugil-ide@latest)`);
  }
  if (!result.configured) {
    console.log('  note: no module registry configured — set MUGIL_IDE_MODULES_REGISTRY (or --registry) to enable remote module updates');
  }
  console.log('');
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function runLogin(provider?: string): Promise<void> {
  if (provider && !providerById(provider)) {
    program.error(
      'error: unknown provider "' + provider + '" — use openrouter | openai | anthropic | openai-custom | anthropic-custom',
    );
  }
  if (!process.stdin.isTTY) {
    console.log(
      '  login needs an interactive terminal — set the key manually in your env file, or run: mugil-ide login',
    );
    return;
  }
  let resolveResult!: (r: LoginResult) => void;
  const done = new Promise<LoginResult>((res) => {
    resolveResult = res;
  });
  const app = render(React.createElement(LoginWizard, { initialProvider: provider, onDone: resolveResult }));
  const result = await done;
  app.unmount();
  if (result.ok && result.provider && result.file) {
    const p = providerById(result.provider)!;
    console.log(`\n  ✓ ${p.label} configured — key saved to ${result.file}`);
    console.log(`    run "mugil-ide run <prompt>" — model calls will use ${p.keyVar}\n`);
  } else if (result.error === 'cancelled') {
    console.log('\n  login cancelled — nothing saved\n');
  } else {
    console.log(`\n  ✗ login failed: ${result.error ?? 'unknown error'}\n`);
  }
}

async function interactive(): Promise<void> {
  const engine = createEngine(loadConfig());
  let resolveExit!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const app = render(
    React.createElement(ChatApp, { engine, onExit: () => resolveExit() }),
  );
  await done;
  app.unmount();
  await engine.backend.close();
}

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
