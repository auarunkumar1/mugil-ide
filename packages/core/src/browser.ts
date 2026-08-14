/**
 * Browser-safe engine entry.
 *
 * Re-exports the pure token-efficiency surface of the engine — the credited
 * modules (caveman, rtk, ponytail, signature-remover), the refine cascade and
 * the tokenizer — without any Node builtins or filesystem access.
 *
 * Bundlers that import this file (e.g. a future GUI client) never pull in
 * `node:fs`/`node:os`/`node:path`/`tiktoken`; rule loading falls back to the
 * bundled JSON defaults (the fs-backed override store is Node-only), and the
 * tokenizer falls back to the deterministic estimator when tiktoken's WASM
 * cannot load in the browser.
 */

export { cavemanStrategy } from './modules/caveman/index.js';
export { rtkStrategy, compressCommandOutput } from './modules/rtk/index.js';
export type { CompressOutputOptions } from './modules/rtk/index.js';
export { ponytailInstruction, ponytailOutputBudget } from './modules/ponytail/index.js';
export type { PonytailOptions } from './modules/ponytail/index.js';
export { stripSignatures, stripCodeSignatures } from './modules/signature-remover/index.js';
export type { ProviderName, StripOptions } from './modules/signature-remover/index.js';
export { refinePrompt, truncateToBudget } from './refine.js';
export type { RefineOptions } from './refine.js';
export { countTokens, getTokenizer } from './token/tokenizer.js';
export type { Tokenizer } from './token/tokenizer.js';
export type {
  RefineResult,
  StrategyResult,
  Usage,
  ModelSpec,
  ModelTier,
} from './types.js';
