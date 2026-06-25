/** Express `trust proxy` setting derived from TRUST_PROXY env. */
export type TrustProxySetting = false | number | string | string[];

const TRUST_PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const IPV4_CIDR_RE = new RegExp(
  `^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}\\/(?:[0-9]|[12]\\d|3[0-2])$`,
);

function isValidTrustProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_KEYWORDS.has(entry)) {
    return true;
  }
  return IPV4_RE.test(entry) || IPV4_CIDR_RE.test(entry);
}

function parseTrustProxyEntry(entry: string): string {
  if (!isValidTrustProxyEntry(entry)) {
    throw new Error(
      `Invalid TRUST_PROXY entry "${entry}". Use a hop count (e.g. 1), an IPv4 address, a CIDR (e.g. 10.0.0.0/8), or loopback/linklocal/uniquelocal.`,
    );
  }
  return entry;
}

/**
 * Parse TRUST_PROXY env into an Express-compatible `trust proxy` value.
 *
 * - `false`, `0`, empty, unset → `false` (direct client connection; local dev)
 * - `1`, `2`, … → hop count (one cloud load balancer → `1`)
 * - `10.0.0.0/8` or `203.0.113.10` → single trusted subnet/IP
 * - `10.0.0.0/8,172.16.0.0/12` → comma-separated trusted subnets/IPs
 */
export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'false' || trimmed === '0') {
    return false;
  }

  if (/^\d+$/.test(trimmed)) {
    const hops = Number(trimmed);
    if (hops < 1) {
      return false;
    }
    return hops;
  }

  const entries = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseTrustProxyEntry);

  if (entries.length === 0) {
    return false;
  }
  if (entries.length === 1) {
    return entries[0];
  }
  return entries;
}
