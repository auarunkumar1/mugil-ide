import * as os from 'node:os';
import { generateQrSvg, generateQrAnsi } from './qr.js';

/**
 * Returns all non-internal IPv4 addresses of the host machine (e.g. 192.168.x.x, 10.x.x.x).
 */
export function getLocalNetworkAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  // Prioritize typical LAN subnets (192.168.x.x, 10.x.x.x, 172.x.x.x)
  return addresses.sort((a, b) => {
    const isPrivate = (ip: string) =>
      ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
    return (isPrivate(b) ? 1 : 0) - (isPrivate(a) ? 1 : 0);
  });
}

/**
 * Checks whether an IP or hostname is a private/local network address.
 */
export function isLocalOrLanHost(host: string): boolean {
  const h = host.toLowerCase().split(':')[0]; // strip port if present
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') {
    return true;
  }
  // Check RFC 1918 Private IPv4 Ranges
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;

  // Check known interface IPs
  const localIps = getLocalNetworkAddresses();
  return localIps.includes(h);
}

export interface RemoteStreamDetails {
  enabled: boolean;
  port: number;
  token: string;
  localUrl: string;
  networkUrls: string[];
  primaryNetworkUrl: string | null;
  qrSvg: string | null;
  qrAnsi: string | null;
}

/**
 * Builds remote device stream metadata, links, and pre-rendered QR codes.
 */
export function getRemoteStreamDetails(
  port: number,
  token: string,
  isRemoteBound = false,
): RemoteStreamDetails {
  const localUrl = `http://localhost:${port}/?token=${token}`;
  const networkIps = getLocalNetworkAddresses();
  const networkUrls = networkIps.map((ip) => `http://${ip}:${port}/?token=${token}`);
  const primaryNetworkUrl = networkUrls.length > 0 ? networkUrls[0] : null;

  const targetUrl = primaryNetworkUrl || localUrl;
  const qrSvg = generateQrSvg(targetUrl, { size: 280, margin: 3 });
  const qrAnsi = generateQrAnsi(targetUrl);

  return {
    enabled: isRemoteBound || networkUrls.length > 0,
    port,
    token,
    localUrl,
    networkUrls,
    primaryNetworkUrl,
    qrSvg,
    qrAnsi,
  };
}
