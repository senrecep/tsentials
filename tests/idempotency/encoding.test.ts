import {
  isWellFormed,
  sha256Hex,
  toBase64Url,
  toHex,
  utf8,
} from '../../src/idempotency/encoding.js';
import { fingerprintOf, stableStringify } from '../../src/idempotency/index.js';

describe('stableStringify', () => {
  it('sorts object keys at every depth', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
  });

  it('follows JSON.stringify for undefined, functions and symbols', () => {
    expect(stableStringify({ a: undefined, b: () => 1, c: Symbol('x'), d: null })).toBe(
      '{"d":null}',
    );
    expect(stableStringify([undefined, () => 1, Symbol('x')])).toBe('[null,null,null]');
    expect(stableStringify(undefined)).toBe('null');
  });

  it('honours toJSON and writes BigInt as a decimal string', () => {
    expect(stableStringify({ at: new Date('2026-01-01T00:00:00Z'), n: 10n })).toBe(
      '{"at":"2026-01-01T00:00:00.000Z","n":"10"}',
    );
  });

  it('writes primitives like JSON.stringify', () => {
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(1.5)).toBe('1.5');
    expect(stableStringify(true)).toBe('true');
  });

  it('allows a shared reference that is not circular', () => {
    const shared = { x: 1 };
    expect(stableStringify([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });

  it('throws on a circular reference', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => stableStringify(a)).toThrow(TypeError);
  });
});

describe('fingerprintOf', () => {
  it('is the same for objects with reordered keys', async () => {
    expect(await fingerprintOf({ a: 1, b: 2 })).toBe(await fingerprintOf({ b: 2, a: 1 }));
    expect(await fingerprintOf({ a: 1 })).not.toBe(await fingerprintOf({ a: 2 }));
    expect(await fingerprintOf('')).toBe(await sha256Hex('""'));
  });
});

describe('byte helpers', () => {
  it('encodes hex and unpadded base64url', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(toBase64Url(new Uint8Array([1, 2, 3]))).toBe('AQID');
    expect(utf8('\u00e9').length).toBe(2);
  });

  it('hashes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('detects lone surrogates', () => {
    expect(isWellFormed('a\uD83D\uDE00b')).toBe(true);
    expect(isWellFormed('\uD83D')).toBe(false);
    expect(isWellFormed('\uDE00')).toBe(false);
  });
});
