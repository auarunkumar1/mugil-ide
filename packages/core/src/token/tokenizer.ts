import type { Tiktoken, TiktokenEncoding } from 'tiktoken';

/**
 * Tokenizer interface. The engine never depends on a concrete tokenizer so it
 * can degrade gracefully: if tiktoken's WASM cannot be initialized (offline,
 * sandboxed env, bundler issues) we fall back to a deterministic estimator.
 */
export interface Tokenizer {
  readonly name: string;
  count(text: string): number;
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

const DEFAULT_ENCODING: TiktokenEncoding = 'cl100k_base';

// tiktoken is loaded lazily so this module (and everything that imports it)
// stays browser-safe: in a browser bundle the require below is undefined and
// the try/catch falls back to the deterministic estimator. The import is
// type-only above, so no tiktoken code ships to browsers.
type TiktokenModule = { get_encoding: (encoding: string) => Tiktoken };
let tiktokenModule: TiktokenModule | undefined;
let tiktokenFailed = false;

function loadTiktoken(): TiktokenModule | undefined {
  if (tiktokenModule) return tiktokenModule;
  if (tiktokenFailed) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tiktokenModule = require('tiktoken') as TiktokenModule;
  } catch {
    tiktokenFailed = true;
    return undefined;
  }
  return tiktokenModule;
}

/**
 * Heuristic estimator used when tiktoken is unavailable. Roughly
 * chars/4 for English text, slightly conservative on the low side.
 */
class EstimatorTokenizer implements Tokenizer {
  readonly name = 'estimator';

  count(text: string): number {
    if (text.length === 0) return 0;
    // ~4 chars per token for English, but code/symbols are denser.
    const words = text.trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(text.length / 4) + Math.floor(words / 8));
  }

  encode(text: string): number[] {
    // Estimator doesn't produce a real vocabulary; emit a per-character sketch.
    return Array.from({ length: this.count(text) }, (_, i) => i);
  }

  decode(tokens: number[]): string {
    return `[${tokens.length} tokens]`;
  }
}

const estimator = new EstimatorTokenizer();

class TiktokenTokenizer implements Tokenizer {
  readonly name = `tiktoken:${DEFAULT_ENCODING}`;
  private enc: Tiktoken | undefined;
  private failed = false;

  private init(): Tiktoken | undefined {
    if (this.enc) return this.enc;
    if (this.failed) return undefined;
    const mod = loadTiktoken();
    if (!mod) {
      this.failed = true;
      return undefined;
    }
    try {
      // get_encoding loads the WASM synchronously from node_modules.
      this.enc = mod.get_encoding(DEFAULT_ENCODING);
    } catch {
      this.failed = true;
      return undefined;
    }
    return this.enc;
  }

  count(text: string): number {
    const enc = this.init();
    if (!enc) return estimator.count(text);
    return enc.encode(text, 'all').length;
  }

  encode(text: string): number[] {
    const enc = this.init();
    if (!enc) return estimator.encode(text);
    return Array.from(enc.encode(text, 'all'));
  }

  decode(tokens: number[]): string {
    const enc = this.init();
    if (!enc) return estimator.decode(tokens);
    return new TextDecoder().decode(enc.decode(new Uint32Array(tokens)));
  }
}

let shared: Tokenizer | undefined;

/**
 * Returns a shared tokenizer instance. Prefers tiktoken; transparently
 * degrades to the estimator if initialization fails.
 */
export function getTokenizer(): Tokenizer {
  if (!shared) shared = new TiktokenTokenizer();
  return shared;
}

export function countTokens(text: string): number {
  return getTokenizer().count(text);
}
