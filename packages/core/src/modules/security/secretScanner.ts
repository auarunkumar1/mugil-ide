/**
 * Secret scanner
 * ==============
 * Pure, dependency-free detection of credentials in free text: API keys,
 * bearer/basic auth headers, database connection strings, private key blocks,
 * and password-ish CLI flags / assignments.
 *
 * Used at every point where text would otherwise leave the machine:
 *   - user input ingestion (CLI + Web UI),
 *   - tool output before it is fed back to the model,
 *   - the HandoffManager choke point before any remote provider call.
 *
 * Detection is span-based so callers can replace exactly the secret and keep
 * the surrounding text intact.
 */

export interface SecretMatch {
  /** Stable type slug, e.g. `OPENAI_API_KEY` — also used in the vault token. */
  type: string;
  /** The secret itself. */
  value: string;
  /** Inclusive start offset in the scanned text. */
  start: number;
  /** Exclusive end offset in the scanned text. */
  end: number;
}

interface ScanPattern {
  type: string;
  regex: RegExp;
  /** Capture group holding only the secret portion (defaults to the whole match). */
  group?: number;
  /** Reject matches whose Shannon entropy is below this (drops lookalikes). */
  minEntropy?: number;
  /** Extra rejection rule. */
  reject?: (value: string) => boolean;
}

/** Values that only *look* like secrets: docs, fixtures, redactions. */
const PLACEHOLDER =
  /^(?:x{4,}|\*{4,}|\.{3,}|<.*>|\$\{.*\}|your[_-]|example|changeme|placeholder|redacted|dummy|sample|test|fake|todo)/i;

function notPlaceholder(value: string): boolean {
  return value.length > 0 && !PLACEHOLDER.test(value) && !/[<>{}]/.test(value);
}

/** Shannon entropy in bits per character — random keys sit around 4.0–5.0. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const SECRET_PATTERNS: ScanPattern[] = [
  // --- AI & cloud provider keys (specific prefixes first) -------------------
  { type: 'OPENAI_PROJECT_KEY', regex: /\bsk-proj-[A-Za-z0-9_-]{15,}/g },
  { type: 'ANTHROPIC_API_KEY', regex: /\bsk-ant-[A-Za-z0-9_-]{15,}/g },
  { type: 'OPENROUTER_API_KEY', regex: /\bsk-or-v1-[A-Za-z0-9_-]{15,}/g },
  { type: 'OPENAI_API_KEY', regex: /\bsk-[A-Za-z0-9]{30,}/g },
  { type: 'GOOGLE_API_KEY', regex: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { type: 'AWS_ACCESS_KEY_ID', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'GITHUB_TOKEN', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { type: 'SLACK_TOKEN', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}/g },
  { type: 'STRIPE_KEY', regex: /\bsk_live_[A-Za-z0-9]{20,}/g },
  { type: 'HUGGINGFACE_TOKEN', regex: /\bhf_[A-Za-z0-9]{20,}/g },

  // --- Private keys & certificates -----------------------------------------
  {
    type: 'PRIVATE_KEY',
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },

  // --- Auth headers ---------------------------------------------------------
  { type: 'BEARER_TOKEN', regex: /\bBearer\s+([A-Za-z0-9\-._~+/]{16,}=*)/g, group: 1 },
  { type: 'BASIC_AUTH', regex: /\bBasic\s+([A-Za-z0-9+/=]{16,})/g, group: 1 },

  // --- Connection strings (the password portion only) -----------------------
  {
    type: 'CONNECTION_PASSWORD',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^:\s/@]+:([^@\s/]+)@/gi,
    group: 1,
  },

  // --- CLI flags / assignments ---------------------------------------------
  {
    type: 'CLI_PASSWORD',
    regex: /(?:--password|--passwd|--api[-_]?key|--token|--secret)[=\s]+(["']?)([^\s"']{6,})\1/gi,
    group: 2,
  },
  {
    type: 'PASSWORD_ASSIGNMENT',
    regex:
      /\b(?:password|passwd|pwd|secret|api[-_]?key|access[-_]?token)\s*[:=]\s*["']?([A-Za-z0-9_\-+/=]{12,})["']?/gi,
    group: 1,
    minEntropy: 3,
    reject: notPlaceholder,
  },
];

/**
 * Cheap pre-filter. Scanning every message of a 64k-token history 13 times per
 * request adds up, so bail out unless the text contains at least one *hint*
 * substring that every pattern below requires. Deliberately loose — a false
 * positive only costs the full scan.
 */
const HINT =
  /sk-|bearer|basic |akia|asia|gh[pousr]_|xox[baprs]-|aiza|sk_live_|hf_|begin |:\/\/|passw|secret|api[-_]?key|token/i;

/** All credential spans in `text`, ordered by position, never overlapping. */
export function scanSecrets(text: string): SecretMatch[] {
  if (!text || !HINT.test(text)) return [];
  const found: SecretMatch[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const flags = pattern.regex.flags.includes('g')
      ? pattern.regex.flags
      : `${pattern.regex.flags}g`;
    const re = new RegExp(pattern.regex.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = pattern.group !== undefined ? match[pattern.group] : match[0];
      if (!value) {
        if (match[0].length === 0) re.lastIndex += 1;
        continue;
      }
      const start = match.index + (pattern.group !== undefined ? match[0].indexOf(value) : 0);
      const accept =
        start >= 0 &&
        (!pattern.minEntropy || shannonEntropy(value) >= pattern.minEntropy) &&
        (!pattern.reject || pattern.reject(value));
      if (accept) found.push({ type: pattern.type, value, start, end: start + value.length });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  // Earliest match wins; on a tie prefer the longer span so `sk-ant-…` is not
  // split by the generic `sk-…` rule.
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: SecretMatch[] = [];
  for (const candidate of found) {
    if (out.some((kept) => candidate.start < kept.end && kept.start < candidate.end)) continue;
    out.push(candidate);
  }
  return out;
}

/** True when `text` contains at least one credential-looking span. */
export function hasSecrets(text: string): boolean {
  return scanSecrets(text).length > 0;
}
