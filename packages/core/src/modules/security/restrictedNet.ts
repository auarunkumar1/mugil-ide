/**
 * Restricted-network guard
 * ========================
 * One implementation of "this host/IP is private, loopback, link-local or a
 * cloud metadata endpoint", shared by `webfetch` and the skill installer so the
 * two cannot drift apart.
 */
import * as dns from 'node:dns/promises';

/** Check if an IP address belongs to private, loopback, link-local, cloud metadata, or ULA ranges. */
export function isRestrictedIp(rawIp: string): boolean {
  let ip = rawIp.trim();
  if (ip === 'localhost' || ip === '::1' || ip === '::' || ip === '0.0.0.0') return true;
  // Strip IPv6 brackets if present (e.g. [fd00::1])
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const rest = ip.slice(7);
    if (rest.includes('.')) {
      ip = rest;
    }
  }
  const lower = ip.toLowerCase();
  // IPv6 ULA (fc00::/7 -> fc00 to fdff)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
  // IPv6 Link-Local (fe80::/10 -> fe80 to febf)
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // IPv6 loopback variants
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts;
    if (a === 127) return true; // 127.0.0.0/8 Loopback
    if (a === 10) return true; // 10.0.0.0/8 Private
    if (a === 172 && b! >= 16 && b! <= 31) return true; // 172.16.0.0/12 Private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 Private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 Link-local / Cloud metadata
    if (a === 100 && b! >= 64 && b! <= 127) return true; // 100.64.0.0/10 Carrier-grade NAT
    if (a === 0) return true; // 0.0.0.0/8 Broadcast / Current network
    return false;
  }
  return false;
}

export interface GuardedFetchOptions {
  fetchFn?: typeof fetch;
  dnsLookupFn?: (hostname: string) => Promise<{ address: string; family?: number }>;
  headers?: Record<string, string>;
  maxRedirects?: number;
  timeoutMs?: number;
}

/**
 * Fetches an http(s) URL, refusing local/private hosts and re-checking the
 * hostname on every redirect hop (so a 302 to 169.254.169.254 fails too).
 * Throws on an unsafe or unreachable target instead of returning a response.
 */
export async function guardedFetch(
  urlStr: string,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const lookup = options.dnsLookupFn ?? dns.lookup;
  const maxRedirects = options.maxRedirects ?? 5;

  let current: URL;
  try {
    current = new URL(urlStr);
  } catch {
    throw new Error(`invalid URL: ${urlStr}`);
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`only http:// and https:// URLs are supported (got ${current.protocol}//).`);
    }
    const host = current.hostname;
    if (host === 'localhost' || isRestrictedIp(host)) {
      throw new Error(`refusing to fetch local or private address "${host}"`);
    }
    let address: string;
    try {
      address = (await lookup(host)).address;
    } catch (err: unknown) {
      throw new Error(
        `DNS lookup failed for "${host}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (isRestrictedIp(address)) {
      throw new Error(`host "${host}" resolves to private address ${address} (forbidden)`);
    }

    const res = await fetchFn(current, {
      redirect: 'manual',
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    });

    if (![301, 302, 303, 307, 308].includes(res.status)) return res;
    const location = res.headers?.get?.('location');
    if (!location) throw new Error(`HTTP ${res.status} redirect without Location header.`);
    if (hop === maxRedirects) throw new Error(`too many redirects (max ${maxRedirects}).`);
    current = new URL(location, current);
  }
  throw new Error(`too many redirects (max ${maxRedirects}).`);
}
