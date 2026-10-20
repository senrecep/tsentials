const encoder = new TextEncoder();

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

/** Lowercase hex of the bytes. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Standard base64 with padding; chunked so large inputs do not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Bytes of a standard base64 string; throws on invalid input. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function digest(algorithm: 'SHA-1' | 'SHA-256', data: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, data));
}

/** SHA-256 through the global Web Crypto API. */
export function sha256(data: BufferSource): Promise<Uint8Array> {
  return digest('SHA-256', data);
}

/** SHA-1 through the global Web Crypto API (used only for UUIDv5). */
export function sha1(data: BufferSource): Promise<Uint8Array> {
  return digest('SHA-1', data);
}

/** Hex SHA-256 of the UTF-8 bytes of a string. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await sha256(utf8(text)));
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when the string has no lone surrogate, so its UTF-8 form is well defined. */
export function isWellFormed(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}

/**
 * Deterministic JSON: object keys are sorted, everything else follows `JSON.stringify`
 * (`toJSON` is honoured, `undefined` and functions are dropped from objects and written as
 * `null` in arrays). BigInt values are written as decimal strings. Circular references throw
 * `TypeError`.
 */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();
  const write = (input: unknown, inArray: boolean): string | undefined => {
    let current = input;
    if (
      typeof current === 'object' &&
      current !== null &&
      typeof (current as { toJSON?: unknown }).toJSON === 'function'
    ) {
      current = (current as { toJSON(): unknown }).toJSON();
    }
    if (typeof current === 'bigint') return JSON.stringify(current.toString());
    if (current === undefined || typeof current === 'function' || typeof current === 'symbol') {
      return inArray ? 'null' : undefined;
    }
    if (typeof current !== 'object' || current === null) return JSON.stringify(current);
    if (seen.has(current)) throw new TypeError('stableStringify: circular reference');
    seen.add(current);
    let out: string;
    if (Array.isArray(current)) {
      out = `[${current.map((item) => write(item, true)).join(',')}]`;
    } else {
      const record = current as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const written = write(record[key], false);
        if (written !== undefined) parts.push(`${JSON.stringify(key)}:${written}`);
      }
      out = `{${parts.join(',')}}`;
    }
    seen.delete(current);
    return out;
  };
  return write(value, false) ?? 'null';
}

/** Fingerprint of a value: hex SHA-256 of its {@link stableStringify} form. */
export function fingerprintOf(value: unknown): Promise<string> {
  return sha256Hex(stableStringify(value));
}
