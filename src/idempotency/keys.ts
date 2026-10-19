import { DEFAULT_MAX_KEY_LENGTH } from './constants.js';
import { isWellFormed, sha1, sha256, toBase64Url, toHex, utf8 } from './encoding.js';

/** Namespace of the UUIDv5 keys built by `toUuidV5`. */
export const IDEMPOTENCY_UUID_NAMESPACE = '9c8fbd17-da5f-4f32-a4bf-651721368d5e';

/** Operation name used by `fromMessage`. */
const MESSAGE_OPERATION = 'message';

function isAllowedChar(code: number): boolean {
  return code >= 0x21 && code <= 0x7e && code !== 0x22 && code !== 0x5c;
}

/**
 * True when `value` is a valid idempotency key: 1..`maxLength` characters, each in
 * U+0021..U+007E except `"` and `\`.
 */
export function isValidIdempotencyKey(
  value: string,
  maxLength: number = DEFAULT_MAX_KEY_LENGTH,
): boolean {
  for (let i = 0; i < value.length; i++) {
    if (!isAllowedChar(value.charCodeAt(i))) return false;
  }
  return value.length >= 1 && value.length <= maxLength;
}

/**
 * Normalizes an `Idempotency-Key` header value: surrounding whitespace is trimmed and a
 * structured-field string (`"abc"`) is unquoted. Returns `undefined` when the result is not a
 * valid key.
 */
export function normalizeIdempotencyKey(
  raw: string,
  maxLength: number = DEFAULT_MAX_KEY_LENGTH,
): string | undefined {
  let value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  return isValidIdempotencyKey(value, maxLength) ? value : undefined;
}

function canonicalParts(operation: unknown, ids: readonly unknown[]): string {
  if (typeof operation !== 'string' || operation.length === 0) {
    throw new TypeError('idempotencyKeys: operation must be a non-empty string');
  }
  const parts = [operation, ...ids];
  return parts
    .map((part) => {
      if (typeof part !== 'string') throw new TypeError('idempotencyKeys: ids must be strings');
      if (!isWellFormed(part)) {
        throw new TypeError('idempotencyKeys: parts must be well-formed UTF-16');
      }
      return `${utf8(part).length}:${part}`;
    })
    .join('|');
}

function uuidV5Bytes(hash: Uint8Array): string {
  const bytes = hash.slice(0, 16);
  // biome-ignore lint/style/noNonNullAssertion: a SHA-1 digest is 20 bytes long
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // biome-ignore lint/style/noNonNullAssertion: a SHA-1 digest is 20 bytes long
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidInput(namespace: string, name: string): Uint8Array<ArrayBuffer> {
  const hex = namespace.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new TypeError(`Invalid UUID namespace: ${namespace}`);
  const nameBytes = utf8(name);
  const input = new Uint8Array(16 + nameBytes.length);
  for (let i = 0; i < 16; i++) input[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  input.set(nameBytes, 16);
  return input;
}

/** Builds a UUIDv5 (RFC 9562) of `name` in `namespace` with an injected SHA-1. */
export function uuidV5With<R>(
  sha1Fn: (data: Uint8Array<ArrayBuffer>) => R,
  namespace: string,
  name: string,
): R extends Promise<unknown> ? Promise<string> : string {
  const hash = sha1Fn(uuidInput(namespace, name));
  return (
    hash instanceof Promise ? hash.then(uuidV5Bytes) : uuidV5Bytes(hash as Uint8Array)
  ) as R extends Promise<unknown> ? Promise<string> : string;
}

/** Deterministic key helpers. */
export interface IdempotencyKeyHelpers<S> {
  /**
   * Key of an operation on ids: each part `{utf8ByteLength}:{value}`, joined with `|`. Used as is
   * when it is a valid key, otherwise `h:` + base64url(SHA-256) without padding.
   * Throws `TypeError` for an empty operation, a non-string id or a lone surrogate.
   */
  for(operation: string, ...ids: readonly string[]): S;
  /** Key of a message for one consumer: `for('message', consumer, messageId)`. */
  fromMessage(messageId: string, consumer: string): S;
  /** UUIDv5 of the canonical `for(operation, ...ids)` string (before any hash fallback). */
  toUuidV5(operation: string, ...ids: readonly string[]): S;
  /** The canonical string the key and the UUID are built from. */
  canonical(operation: string, ...ids: readonly string[]): string;
}

/** Synchronous hash functions for {@link createIdempotencyKeys}. */
export interface IdempotencyKeyHashes {
  sha256(data: Uint8Array): Uint8Array;
  sha1(data: Uint8Array): Uint8Array;
}

function hashedKey(digest: Uint8Array): string {
  return `h:${toBase64Url(digest)}`;
}

/**
 * Deterministic idempotency keys (async: hashing uses the global Web Crypto API).
 *
 * ```ts
 * await idempotencyKeys.for('capture', orderId);           // '7:capture|8:order-42'
 * await idempotencyKeys.fromMessage(eventId, 'billing');   // same message, other consumer → other key
 * ```
 */
export const idempotencyKeys: IdempotencyKeyHelpers<Promise<string>> = {
  async for(operation, ...ids) {
    const canonical = canonicalParts(operation, ids);
    if (isValidIdempotencyKey(canonical)) return canonical;
    return hashedKey(await sha256(utf8(canonical)));
  },
  fromMessage(messageId, consumer) {
    return idempotencyKeys.for(MESSAGE_OPERATION, consumer, messageId);
  },
  async toUuidV5(operation, ...ids) {
    return uuidV5With(sha1, IDEMPOTENCY_UUID_NAMESPACE, canonicalParts(operation, ids));
  },
  canonical: (operation, ...ids) => canonicalParts(operation, ids),
};

/**
 * Synchronous variant of {@link idempotencyKeys} with injected hash functions, for example
 * `node:crypto`:
 *
 * ```ts
 * import { createHash } from 'node:crypto';
 * const keys = createIdempotencyKeys({
 *   sha256: (d) => createHash('sha256').update(d).digest(),
 *   sha1: (d) => createHash('sha1').update(d).digest(),
 * });
 * keys.for('capture', orderId); // string
 * ```
 */
export function createIdempotencyKeys(hashes: IdempotencyKeyHashes): IdempotencyKeyHelpers<string> {
  const helpers: IdempotencyKeyHelpers<string> = {
    for(operation, ...ids) {
      const canonical = canonicalParts(operation, ids);
      if (isValidIdempotencyKey(canonical)) return canonical;
      return hashedKey(new Uint8Array(hashes.sha256(utf8(canonical))));
    },
    fromMessage: (messageId, consumer) => helpers.for(MESSAGE_OPERATION, consumer, messageId),
    toUuidV5: (operation, ...ids) =>
      uuidV5With(
        (d: Uint8Array) => new Uint8Array(hashes.sha1(d)),
        IDEMPOTENCY_UUID_NAMESPACE,
        canonicalParts(operation, ids),
      ),
    canonical: (operation, ...ids) => canonicalParts(operation, ids),
  };
  return helpers;
}
