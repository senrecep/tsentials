/**
 * RFC 9562 UUID version 7 generators: a 48-bit Unix millisecond timestamp followed by random bits,
 * so ids sort by creation time. Randomness comes from the global Web Crypto API.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
// 12 bits of rand_a plus the 6 bits beside the variant, the counter layout of the C# Guider version 7.
const MAX_SEQUENCE = 0x3ffff;

let lastMs = -1;
let sequence = 0;

function format(ms: number, b: Uint8Array): string {
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = (ms >>> 24) & 0xff;
  b[3] = (ms >>> 16) & 0xff;
  b[4] = (ms >>> 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += '-';
    s += HEX[b[i] as number];
  }
  return s;
}

/** A new UUIDv7 string (lowercase, hyphenated) with the current time and 74 random bits. */
export function uuidv7(): string {
  return format(Date.now(), globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * A new UUIDv7 that sorts after every id this function returned before in this process.
 * Within one millisecond an 18-bit counter replaces rand_a and the top 6 bits of rand_b; when it
 * overflows, or the clock goes back, the timestamp moves one millisecond ahead, so ids never repeat.
 */
export function monotonicUuidv7(): string {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    sequence = 0;
  } else if (++sequence > MAX_SEQUENCE) {
    lastMs++;
    sequence = 0;
  }
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = sequence >>> 14;
  b[7] = (sequence >>> 6) & 0xff;
  b[8] = sequence & 0x3f;
  return format(lastMs, b);
}
