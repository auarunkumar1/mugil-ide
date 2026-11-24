/**
 * Outbound Network Security Guard
 * ================================
 * Fail-closed enforcement ensuring that detected secrets never cross a network
 * boundary to a remote endpoint in cleartext.
 */

import { scanSecrets } from './secretScanner.js';
import { globalSecretVault, type SecretVault } from './secretVault.js';

export type EndpointClassification = 'loopback' | 'private-lan' | 'remote';

export class SecretLeakError extends Error {
  constructor(public readonly secretType: string, public readonly destination: string) {
    super(`SecretLeakError: Detected un-tokenized ${secretType} directed to remote endpoint: ${destination}`);
    this.name = 'SecretLeakError';
  }
}

/** Classifies an endpoint URL as loopback, private-lan, or remote. */
export function classifyEndpoint(
  urlStr: string,
  allowPrivateLan = false,
): EndpointClassification {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();

    // Loopback addresses
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return 'loopback';
    }

    // RFC1918 Private LAN ranges
    const isPrivateIp =
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^192\.168\./.test(hostname);

    if (isPrivateIp && allowPrivateLan) {
      return 'private-lan';
    }

    return 'remote';
  } catch {
    return 'remote';
  }
}

export interface SanitizeOptions {
  destinationUrl: string;
  expectedProviderKey?: string;
  allowPrivateLan?: boolean;
  vault?: SecretVault;
}

/**
 * Sanitizes an outbound payload (string, object, array, or body) before network transmission.
 * Throws SecretLeakError if an un-tokenized credential survives to a remote endpoint.
 */
export function sanitizeOutbound<T>(payload: T, options: SanitizeOptions): T {
  const vault = options.vault ?? globalSecretVault;
  const classification = classifyEndpoint(options.destinationUrl, options.allowPrivateLan);

  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === 'string') {
    const tokenized = vault.tokenize(payload).text;
    if (classification === 'remote') {
      const remaining = scanSecrets(tokenized);
      // Filter out expected provider key if present in its own auth header
      const leaks = remaining.filter(
        (m) => !options.expectedProviderKey || m.value !== options.expectedProviderKey,
      );
      if (leaks.length > 0) {
        throw new SecretLeakError(leaks[0]!.type, options.destinationUrl);
      }
    }
    return tokenized as unknown as T;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeOutbound(item, options)) as unknown as T;
  }

  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const res: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      // If Authorization or x-api-key header matches expected provider key, permit it
      if (
        (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-api-key') &&
        typeof val === 'string' &&
        options.expectedProviderKey &&
        val.includes(options.expectedProviderKey)
      ) {
        res[key] = val;
        continue;
      }
      res[key] = sanitizeOutbound(val, options);
    }
    return res as unknown as T;
  }

  return payload;
}
