import { diffWords } from 'diff';
import type { Engine, AskOptions } from '@mugil-ide/core';

export interface RunOptions {
  model?: string;
  budget?: string;
  json?: boolean;
  refine?: boolean;
  cache?: boolean;
  ponytail?: boolean;
  outputBudget?: string;
}

/** Runs a single prompt through the pipeline and prints the result. */
export async function runOnce(
  engine: Engine,
  prompt: string,
  options: RunOptions,
): Promise<void> {
  const budget = options.budget ? Number(options.budget) : undefined;
  const ponytail: AskOptions['ponytail'] =
    options.ponytail === false
      ? false
      : options.outputBudget
        ? { outputBudget: Number(options.outputBudget) }
        : true;
  const askOptions: AskOptions = {
    preferredModel: options.model,
    maxTokens: budget,
    noRefine: options.refine === false,
    noCache: options.cache === false,
    ponytail,
  };

  const started = Date.now();
  const result = await engine.pipeline.ask(prompt, askOptions);
  const elapsedMs = Date.now() - started;

  if (options.json) {
    process.stdout.write(JSON.stringify({ ...result, elapsedMs }, null, 2) + '\n');
    return;
  }

  const line = (label: string, value: string) => `  ${label.padEnd(14)}${value}`;

  console.log('');
  console.log('─'.repeat(64));
  console.log(line('model', `${result.model}${result.mock ? ' (mock)' : ''}`));
  console.log(line('cache', result.cache.hit ? `HIT (${result.cache.kind})` : 'miss'));
  console.log(
    line(
      'tokens',
      `${result.refine.originalTokens} -> ${result.refine.refinedTokens} (-${result.refine.savingsPct}%)`,
    ),
  );
  console.log(
    line(
      'strategies',
      result.refine.appliedStrategies.length > 0
        ? result.refine.appliedStrategies.join(', ')
        : '(none needed)',
    ),
  );
  if (ponytail !== false) {
    console.log(line('output', `minimal${typeof ponytail === 'object' && ponytail.outputBudget ? ` (≤${ponytail.outputBudget} tok)` : ' (ponytail)'}`));
  }
  console.log(
    line('usage', `${result.usage.promptTokens} in / ${result.usage.completionTokens} out / ${result.usage.totalTokens} total`),
  );
  console.log(line('elapsed', `${elapsedMs}ms`));
  console.log('─'.repeat(64));

  if (result.refine.original !== result.refine.refined && options.refine !== false) {
    console.log('\nrefined prompt diff:');
    for (const part of diffWords(result.refine.original, result.refine.refined)) {
      if (part.added) process.stdout.write(`  + ${part.value}`);
      else if (part.removed) process.stdout.write(`  - ${part.value}`);
    }
    console.log('');
  }

  console.log('\nresponse:\n');
  console.log(result.response);
  console.log('');
}
