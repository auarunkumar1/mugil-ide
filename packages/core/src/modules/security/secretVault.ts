/**
 * Ephemeral secret vault
 * ======================
 * Replaces detected credentials with opaque tokens (`[MUGIL_SECRET_TYPE_N]`)
 * and keeps the real value **in process memory only**.
 *
 * Lifecycle guarantees:
 *   - Nothing is ever written to disk: message history, session files and the
 *     response cache only ever see tokens.
 *   - The vault is cleared when the process exits (no persistence by design).
 *   - Only `resolve()` — used by local tool execution such as `run_command` —
 *     can turn a token back into the real secret. Remote providers only ever
 *     receive tokens.
 */
import { scanSecrets, type SecretMatch } from './secretScanner.js';

export interface TokenizeResult {
  /** Input with every detected secret replaced by a token. */
  text: string;
  /** Number of secrets replaced (repeats of the same value reuse one token). */
  count: number;
  /** Tokens handed out, in first-seen order. */
  tokens: string[];
  /** Type slugs for the detected secrets. */
  types: string[];
}

const TOKEN_RE = /\[MUGIL_SECRET_[A-Z0-9_]+?_\d+\]/g;

/** Builds the opaque token for a secret type + sequence id. */
export function secretToken(type: string, id: number): string {
  return `[MUGIL_SECRET_${type.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${id}]`;
}

export class SecretVault {
  private readonly secrets = new Map<string, string>();
  private readonly byValue = new Map<string, string>();
  private seq = 0;

  get size(): number {
    return this.secrets.size;
  }

  /** Replaces every detected secret in `text` with a vault token. */
  tokenize(text: string): TokenizeResult {
    const empty: TokenizeResult = { text, count: 0, tokens: [], types: [] };
    if (!text) return empty;
    const matches = scanSecrets(text);
    if (matches.length === 0) return empty;

    const tokens: string[] = [];
    const types: string[] = [];
    let out = '';
    let cursor = 0;
    for (const match of matches) {
      out += text.slice(cursor, match.start);
      const token = this.assign(match);
      out += token;
      tokens.push(token);
      types.push(match.type);
      cursor = match.end;
    }
    out += text.slice(cursor);
    return { text: out, count: matches.length, tokens, types };
  }

  /** Token for this exact secret value, reusing one if it is already vaulted. */
  private assign(match: SecretMatch): string {
    const existing = this.byValue.get(match.value);
    if (existing) return existing;
    this.seq += 1;
    const token = secretToken(match.type, this.seq);
    this.secrets.set(token, match.value);
    this.byValue.set(match.value, token);
    return token;
  }

  /** Looks up the real value behind a token. */
  lookup(token: string): string | undefined {
    return this.secrets.get(token);
  }

  /**
   * Substitutes every known token in `text` with its real value. Local tool
   * execution only — never call this on anything headed for a remote model.
   */
  resolve(text: string): string {
    if (this.secrets.size === 0 || !text.includes('[MUGIL_SECRET_')) return text;
    return text.replace(TOKEN_RE, (token) => this.secrets.get(token) ?? token);
  }

  /** True when `text` references at least one vaulted token. */
  hasToken(text: string): boolean {
    if (this.secrets.size === 0 || !text.includes('[MUGIL_SECRET_')) return false;
    return this.resolve(text) !== text;
  }

  clear(): void {
    this.secrets.clear();
    this.byValue.clear();
    this.seq = 0;
  }
}

/** Process-wide vault: one per running IDE session. */
export const globalSecretVault = new SecretVault();

/** Convenience: tokenize with the process-wide vault. */
export function tokenizeSecrets(text: string): string {
  return globalSecretVault.tokenize(text).text;
}

/** Convenience: resolve with the process-wide vault (local execution only). */
export function resolveSecrets(text: string): string {
  return globalSecretVault.resolve(text);
}
