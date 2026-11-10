type Network = readonly [bytes: readonly number[], prefix: number];

// The ranges of the CSharpEssentials DefaultOutboundAddressPolicy.
const BLOCKED_IPV4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map(network);

const BLOCKED_IPV6 = [
  '::/128',
  '::1/128',
  '::ffff:0:0:0/96',
  '100::/64',
  'fc00::/7',
  'fe80::/10',
  'fec0::/10',
  'ff00::/8',
  '2001::/32',
  '2001:2::/48',
  '2001:10::/28',
  '2001:db8::/32',
  '3fff::/20',
  '5f00::/16',
  '64:ff9b:1::/48',
].map(network);

const IPV4_COMPATIBLE = network('::/96');
const UNSPECIFIED_AND_LOOPBACK = network('::/127');
const IPV4_MAPPED = network('::ffff:0:0/96');
const SIIT = network('::ffff:0:0:0/96');
const NAT64 = network('64:ff9b::/96');
const SIX_TO_FOUR = network('2002::/16');

/**
 * Returns `true` when `address` is an IP literal that an outbound request must not reach, using
 * the ranges of the CSharpEssentials SSRF guard: unspecified, loopback, private (RFC 1918),
 * CGNAT, link-local (including the 169.254.169.254 metadata endpoint), unique local,
 * multicast, broadcast, reserved, and the documentation and benchmark ranges. An IPv4 address
 * embedded in IPv6 (IPv4-mapped, IPv4-compatible, SIIT, NAT64 `64:ff9b::/96`, 6to4) is checked
 * as IPv4 too.
 *
 * Parsing is strict: dotted-decimal IPv4 with four parts and no leading zeros, or IPv6 (hex
 * groups, `::`, an optional dotted IPv4 tail), optionally in brackets. Anything else, such as a
 * host name, `127.1`, `0177.0.0.1`, `0x7f000001` or a zone id (`fe80::1%eth0`), returns `true`.
 * Resolve host names first and check every address; this is not a full SSRF defence on its own.
 */
export function isBlockedAddress(address: string): boolean {
  const bytes = parseAddress(address);
  if (bytes === undefined) return true;
  return isBlockedBytes(bytes) || isBlockedBytes(normalize(bytes));
}

function isBlockedBytes(bytes: readonly number[]): boolean {
  return (bytes.length === 4 ? BLOCKED_IPV4 : BLOCKED_IPV6).some((n) => contains(n, bytes));
}

function normalize(bytes: readonly number[]): readonly number[] {
  if (bytes.length === 4) return bytes;
  // :: and ::1 are the IPv6 unspecified and loopback addresses, not IPv4-compatible forms.
  const compatible = contains(IPV4_COMPATIBLE, bytes) && !contains(UNSPECIFIED_AND_LOOPBACK, bytes);
  if (compatible || contains(IPV4_MAPPED, bytes) || contains(SIIT, bytes) || contains(NAT64, bytes))
    return bytes.slice(12, 16);
  if (contains(SIX_TO_FOUR, bytes)) return bytes.slice(2, 6);
  return bytes;
}

function contains([net, prefix]: Network, bytes: readonly number[]): boolean {
  if (net.length !== bytes.length) return false;
  for (let bit = 0; bit < prefix; bit += 8) {
    const mask = (0xff << (8 - Math.min(8, prefix - bit))) & 0xff;
    const i = bit / 8;
    if (((net[i] ?? 0) & mask) !== ((bytes[i] ?? 0) & mask)) return false;
  }
  return true;
}

function network(cidr: string): Network {
  const [text = '', prefix = ''] = cidr.split('/');
  const bytes = parseAddress(text);
  if (bytes === undefined) throw new Error(`Invalid network ${cidr}`);
  return [bytes, Number(prefix)];
}

function parseAddress(address: string): number[] | undefined {
  const text = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  return text.includes(':') ? parseIPv6(text) : parseIPv4(text);
}

function parseIPv4(text: string): number[] | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) return undefined;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return undefined;
    const value = Number(part);
    if (value > 255) return undefined;
    bytes.push(value);
  }
  return bytes;
}

function parseIPv6(text: string): number[] | undefined {
  const lastColon = text.lastIndexOf(':');
  let hex = text;
  if (text.includes('.', lastColon)) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === undefined) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    hex = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = hex.split('::');
  if (halves.length > 2) return undefined;
  const groupsOf = (half: string | undefined): string[] => (half ? half.split(':') : []);
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1]);
  let groups = head;
  if (halves.length === 2) {
    if (head.length + tail.length > 7) return undefined;
    groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  }
  if (groups.length !== 8) return undefined;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}
