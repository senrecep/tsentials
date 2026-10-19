import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sha1 } from '../../src/idempotency/encoding.js';
import {
  createIdempotencyKeys,
  IDEMPOTENCY_UUID_NAMESPACE,
  idempotencyKeys,
  isValidIdempotencyKey,
  normalizeIdempotencyKey,
} from '../../src/idempotency/index.js';
import { uuidV5With } from '../../src/idempotency/keys.js';

interface Vectors {
  version: number;
  namespaceUuid: string;
  maxKeyLength: number;
  messageOperation: string;
  rfc9562: { namespace: string; name: string; uuidV5: string };
  for: {
    name: string;
    operation: string;
    ids: string[];
    canonical: string;
    key: string;
    uuidV5: string;
  }[];
  fromMessage: {
    name: string;
    messageId: string;
    consumer: string;
    canonical: string;
    key: string;
  }[];
  invalid: { name: string; operation: string | null; ids: (string | null)[] }[];
}

const raw = readFileSync(new URL('./fixtures/key-vectors.json', import.meta.url));
const vectors = JSON.parse(raw.toString('utf8')) as Vectors;

const syncKeys = createIdempotencyKeys({
  sha256: (d) => createHash('sha256').update(d).digest(),
  sha1: (d) => createHash('sha1').update(d).digest(),
});

describe('key vectors', () => {
  it('is the vendored version 1 file, byte for byte', () => {
    expect(vectors.version).toBe(1);
    expect(createHash('sha256').update(raw).digest('hex')).toMatch(/^637471/);
    expect(vectors.namespaceUuid).toBe(IDEMPOTENCY_UUID_NAMESPACE);
    expect(vectors.maxKeyLength).toBe(255);
    expect(vectors.messageOperation).toBe('message');
  });

  it('builds the RFC 9562 UUIDv5 example', async () => {
    const { namespace, name, uuidV5 } = vectors.rfc9562;
    expect(await uuidV5With(sha1, namespace, name)).toBe(uuidV5);
    expect(uuidV5With((d) => createHash('sha1').update(d).digest(), namespace, name)).toBe(uuidV5);
  });

  for (const v of vectors.for) {
    it(`for: ${v.name}`, async () => {
      expect(idempotencyKeys.canonical(v.operation, ...v.ids)).toBe(v.canonical);
      expect(await idempotencyKeys.for(v.operation, ...v.ids)).toBe(v.key);
      expect(await idempotencyKeys.toUuidV5(v.operation, ...v.ids)).toBe(v.uuidV5);
      expect(syncKeys.canonical(v.operation, ...v.ids)).toBe(v.canonical);
      expect(syncKeys.for(v.operation, ...v.ids)).toBe(v.key);
      expect(syncKeys.toUuidV5(v.operation, ...v.ids)).toBe(v.uuidV5);
    });
  }

  for (const v of vectors.fromMessage) {
    it(`fromMessage: ${v.name}`, async () => {
      expect(await idempotencyKeys.fromMessage(v.messageId, v.consumer)).toBe(v.key);
      expect(syncKeys.fromMessage(v.messageId, v.consumer)).toBe(v.key);
      expect(idempotencyKeys.canonical('message', v.consumer, v.messageId)).toBe(v.canonical);
    });
  }

  for (const v of vectors.invalid) {
    it(`invalid: ${v.name}`, async () => {
      const op = v.operation as string;
      const ids = v.ids as string[];
      await expect(idempotencyKeys.for(op, ...ids)).rejects.toThrow(TypeError);
      expect(() => syncKeys.for(op, ...ids)).toThrow(TypeError);
      expect(() => idempotencyKeys.canonical(op, ...ids)).toThrow(TypeError);
    });
  }

  it('covers both key forms', () => {
    expect(vectors.for.some((v) => v.key.startsWith('h:'))).toBe(true);
    expect(vectors.for.some((v) => v.key === v.canonical)).toBe(true);
  });
});

describe('lone surrogates', () => {
  it.each(['\uD800', '\uDC00', 'a\uD800b', '\uDC00\uD800'])('rejects %j', async (part) => {
    await expect(idempotencyKeys.for('op', part)).rejects.toThrow('well-formed');
    expect(() => syncKeys.for(part)).toThrow(TypeError);
  });

  it('accepts a surrogate pair', async () => {
    expect(await idempotencyKeys.for('op', '\uD83D\uDE00')).toMatch(/^h:/);
  });
});

describe('isValidIdempotencyKey', () => {
  it('accepts printable ASCII except quote and backslash', () => {
    expect(isValidIdempotencyKey('abc-123_~!')).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(255))).toBe(true);
  });

  it.each(['', 'a b', 'a"b', 'a\\b', '\u00e9', '\t', 'a'.repeat(256)])('rejects %j', (key) => {
    expect(isValidIdempotencyKey(key)).toBe(false);
  });

  it('honours a custom max length', () => {
    expect(isValidIdempotencyKey('abcd', 3)).toBe(false);
    expect(isValidIdempotencyKey('abc', 3)).toBe(true);
  });
});

describe('normalizeIdempotencyKey', () => {
  it('trims and unquotes', () => {
    expect(normalizeIdempotencyKey('  abc  ')).toBe('abc');
    expect(normalizeIdempotencyKey('"abc"')).toBe('abc');
    expect(normalizeIdempotencyKey(' "abc" ', 3)).toBe('abc');
  });

  it('returns undefined for an invalid key', () => {
    expect(normalizeIdempotencyKey('""')).toBeUndefined();
    expect(normalizeIdempotencyKey('"')).toBeUndefined();
    expect(normalizeIdempotencyKey('a b')).toBeUndefined();
    expect(normalizeIdempotencyKey('abcd', 3)).toBeUndefined();
  });
});

describe('uuidV5With', () => {
  it('rejects a malformed namespace', () => {
    expect(() => uuidV5With(() => new Uint8Array(20), 'not-a-uuid', 'x')).toThrow(TypeError);
  });

  it('sets the version and variant bits', () => {
    const uuid = uuidV5With(() => new Uint8Array(20).fill(0xff), IDEMPOTENCY_UUID_NAMESPACE, 'x');
    expect(uuid).toBe('ffffffff-ffff-5fff-bfff-ffffffffffff');
  });
});
