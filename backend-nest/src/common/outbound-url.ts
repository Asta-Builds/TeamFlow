import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Outbound request guard for user-supplied URLs (SEO probes).
 *
 * Every connection is resolved through `publicOnlyLookup`, so redirects and
 * DNS rebinding cannot reach loopback, private, link-local (cloud metadata),
 * or other non-public addresses. Private targets are allowed only outside
 * production when OUTBOUND_ALLOW_PRIVATE_HOSTS=true (local development).
 */

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export class BlockedOutboundUrlError extends Error {
  readonly code = 'EBLOCKEDHOST';
}

export function privateTargetsAllowed(): boolean {
  return (
    process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS === 'true' &&
    process.env.NODE_ENV !== 'production'
  );
}

export function isPublicAddress(address: string): boolean {
  let candidate = address;
  let family = isIP(candidate);
  if (family === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
    if (mapped) {
      candidate = mapped[1];
      family = 4;
    }
  }
  if (family === 4) return !blocked.check(candidate, 'ipv4');
  if (family === 6) return !blocked.check(candidate, 'ipv6');
  return false;
}

type AddressEntry = { address: string; family: 4 | 6 };
type LookupCallback = (
  err: Error | null,
  address: AddressEntry | AddressEntry[],
  family?: 4 | 6,
) => void;

/**
 * axios `lookup` implementation that refuses non-public destinations.
 * It is applied to every connection, including redirects.
 */
export function publicOnlyLookup(
  hostname: string,
  options: object,
  callback: LookupCallback,
): void {
  const opts = (options || {}) as { family?: number; all?: boolean };
  dnsLookup(hostname, { all: true, family: opts.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, []);
    const list: AddressEntry[] = addresses.map((a: LookupAddress) => ({
      address: a.address,
      family: a.family === 6 ? 6 : 4,
    }));
    if (!list.length) {
      return callback(new BlockedOutboundUrlError(`No address found for ${hostname}`), []);
    }
    if (!privateTargetsAllowed() && list.some((a) => !isPublicAddress(a.address))) {
      return callback(
        new BlockedOutboundUrlError(`Refusing to connect to a non-public address for ${hostname}`),
        [],
      );
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0], list[0].family);
  });
}

/** Validate a user-supplied URL before any request is made. */
export function assertAuditableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedOutboundUrlError(`Invalid URL format: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedOutboundUrlError('Only http and https URLs can be audited.');
  }
  if (url.username || url.password) {
    throw new BlockedOutboundUrlError('URLs containing credentials cannot be audited.');
  }
  if (!privateTargetsAllowed()) {
    if (url.port && url.port !== '80' && url.port !== '443') {
      throw new BlockedOutboundUrlError('Only the default HTTP and HTTPS ports can be audited.');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) {
      throw new BlockedOutboundUrlError('Private and internal addresses cannot be audited.');
    }
    if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
      throw new BlockedOutboundUrlError('Internal host names cannot be audited.');
    }
  }
  return url;
}
