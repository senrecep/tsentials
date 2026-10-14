import {
  type CursorProtector,
  compareKeyset,
  createKeysetPageResponse,
  decodeCursor,
  encodeCursor,
  KEYSET_DEFAULTS,
  KeysetCursorErrors,
  type KeysetOrdering,
  type KeysetPaginationOptions,
  keysetOrdering,
  keysetPaginate,
  planKeysetPage,
} from '../../src/pagination/index.js';
import type { Result } from '../../src/result/index.js';

interface Row {
  id: number;
  createdAt: Date;
  name: string;
  score: number;
}

const START = Date.UTC(2024, 0, 1);
// 25 rows; rows 10..16 share the same createdAt (7-way tie on the leading key).
const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  createdAt: new Date(START + (i >= 10 && i <= 16 ? 100 : i) * 3_600_000),
  name: `row-${String((i * 7) % 25).padStart(2, '0')}`,
  score: (i * 13) % 5,
}));

const newestFirst = keysetOrdering<Row>('Row')
  .descending('createdAt', 'date')
  .ascending('id', 'number');

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`unexpected failure: ${r.errors.map((e) => e.code).join(', ')}`);
  return r.value;
};

const expectedOrder = (ordering: KeysetOrdering<Row>, source: Row[] = rows): number[] =>
  [...source]
    .sort((a, b) =>
      compareKeyset(
        ordering,
        ordering.keys.map((k) => k.get(a)),
        ordering.keys.map((k) => k.get(b)),
      ),
    )
    .map((r) => r.id);

const walk = (
  ordering: KeysetOrdering<Row>,
  limit: number,
  source: Row[] = rows,
  options: KeysetPaginationOptions = {},
): { forward: number[]; backward: number[] } => {
  const forward: number[] = [];
  let page = unwrap(keysetPaginate(source, { limit }, ordering, options));
  forward.push(...page.items.map((r) => r.id));
  while (page.nextCursor !== undefined) {
    page = unwrap(keysetPaginate(source, { limit, after: page.nextCursor }, ordering, options));
    forward.push(...page.items.map((r) => r.id));
  }
  const backward = page.items.map((r) => r.id);
  while (page.previousCursor !== undefined) {
    page = unwrap(
      keysetPaginate(source, { limit, before: page.previousCursor }, ordering, options),
    );
    backward.unshift(...page.items.map((r) => r.id));
  }
  return { forward, backward };
};

describe('keysetOrdering', () => {
  it('rejects a duplicate key path', () => {
    expect(() =>
      keysetOrdering<Row>('Row').ascending('id', 'number').descending('id', 'number'),
    ).toThrow("Keyset key 'id' is already part of the ordering.");
  });

  it('is immutable — each call returns a new ordering', () => {
    const base = keysetOrdering<Row>('Row');
    const withId = base.ascending('id', 'number');
    expect(base.keys).toHaveLength(0);
    expect(withId.keys).toHaveLength(1);
  });

  it('fingerprint depends on entity, path, kind and direction', () => {
    const fp = (o: KeysetOrdering<Row>) => o.fingerprint;
    const a = keysetOrdering<Row>('Row').ascending('id', 'number');
    expect(fp(a)).toBe(fp(keysetOrdering<Row>('Row').ascending('id', 'number')));
    expect(fp(a)).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(fp(a)).not.toBe(fp(keysetOrdering<Row>('Other').ascending('id', 'number')));
    expect(fp(a)).not.toBe(fp(keysetOrdering<Row>('Row').descending('id', 'number')));
    expect(fp(a)).not.toBe(fp(keysetOrdering<Row>('Row').ascending('id', 'bigint')));
  });

  it('rejects an empty key path', () => {
    expect(() => keysetOrdering<Row>('Row').ascending('', 'number')).toThrow(
      'Keyset key path must not be empty.',
    );
  });

  it('reads a dotted path through a missing parent as that missing value', () => {
    const ordering = keysetOrdering<{ a: { b: number } | null }>('X').ascending('a.b', 'number');
    expect(ordering.keys[0]?.get({ a: null })).toBeNull();
  });

  it('reads dotted paths by default', () => {
    const ordering = keysetOrdering<{ a: { b: number } }>('X').ascending('a.b', 'number');
    expect(ordering.keys[0]?.get({ a: { b: 7 } })).toBe(7);
  });
});

describe('keysetPaginate', () => {
  it.each([1, 3, 7, 24, 25])('walks the canonical order both ways with limit %i', (limit) => {
    const expected = expectedOrder(newestFirst);
    const { forward, backward } = walk(newestFirst, limit);
    expect(forward).toEqual(expected);
    expect(backward).toEqual(expected);
  });

  it('does not skip or repeat rows when seven rows share the leading key and limit is 3', () => {
    const ordering = keysetOrdering<Row>('Row')
      .descending('createdAt', 'date')
      .descending('id', 'number');
    const expected = [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
      .map((r) => r.id);
    const { forward, backward } = walk(ordering, 3);
    expect(rows.filter((r) => r.createdAt.getTime() === START + 100 * 3_600_000)).toHaveLength(7);
    expect(forward).toEqual(expected);
    expect(new Set(forward).size).toBe(forward.length);
    expect(backward).toEqual(expected);
  });

  it('walks string keys', () => {
    const ordering = keysetOrdering<Row>('Row')
      .ascending('name', 'string')
      .ascending('id', 'number');
    const { forward, backward } = walk(ordering, 4);
    expect(forward).toEqual(expectedOrder(ordering));
    expect(backward).toEqual(forward);
  });

  it('reports no previous page on the first page', () => {
    const page = unwrap(keysetPaginate(rows, { limit: 10 }, newestFirst));
    expect(page).toMatchObject({ hasPrevious: false, previousCursor: undefined, hasNext: true });
    expect(page.items).toHaveLength(10);
  });

  it('reports no next page on the last page', () => {
    const first = unwrap(keysetPaginate(rows, { limit: 10 }, newestFirst));
    const second = unwrap(
      keysetPaginate(rows, { limit: 10, after: first.nextCursor }, newestFirst),
    );
    const third = unwrap(
      keysetPaginate(rows, { limit: 10, after: second.nextCursor }, newestFirst),
    );
    expect(third.items).toHaveLength(5);
    expect(third).toMatchObject({ hasNext: false, nextCursor: undefined, hasPrevious: true });
  });

  it('reports no previous page when the backward walk reaches the start', () => {
    const first = unwrap(keysetPaginate(rows, { limit: 10 }, newestFirst));
    const second = unwrap(
      keysetPaginate(rows, { limit: 10, after: first.nextCursor }, newestFirst),
    );
    const back = unwrap(
      keysetPaginate(rows, { limit: 10, before: second.previousCursor }, newestFirst),
    );
    expect(back.items.map((r) => r.id)).toEqual(first.items.map((r) => r.id));
    expect(back).toMatchObject({ hasPrevious: false, previousCursor: undefined, hasNext: true });
  });

  it('returns one page without cursors when all rows fit', () => {
    const page = unwrap(keysetPaginate(rows, { limit: 25 }, newestFirst));
    expect(page.items).toHaveLength(25);
    expect(page).toMatchObject({ nextCursor: undefined, previousCursor: undefined });
  });

  it('returns an empty page without cursors when there are no rows', () => {
    expect(unwrap(keysetPaginate([], { limit: 5 }, newestFirst))).toEqual({
      items: [],
      nextCursor: undefined,
      previousCursor: undefined,
      hasNext: false,
      hasPrevious: false,
    });
  });

  it('clamps the limit to maxLimit and to at least one', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...rows[0], id: i + 1 }) as Row);
    const byId = keysetOrdering<Row>('Row').ascending('id', 'number');
    expect(unwrap(keysetPaginate(many, { limit: 1000 }, byId)).items).toHaveLength(100);
    expect(
      unwrap(keysetPaginate(many, { limit: 1000 }, byId, { maxLimit: 20 })).items,
    ).toHaveLength(20);
    expect(unwrap(keysetPaginate(many, { limit: 0 }, byId)).items).toHaveLength(1);
    expect(unwrap(keysetPaginate(many, { limit: -5 }, byId)).items).toHaveLength(1);
    expect(unwrap(keysetPaginate(many, {}, byId)).items).toHaveLength(KEYSET_DEFAULTS.limit);
  });

  it('plans take = maxLimit + 1 when the limit exceeds the max', () => {
    expect(unwrap(planKeysetPage({ limit: 5000 }, newestFirst))).toMatchObject({
      limit: 100,
      take: 101,
      reverse: false,
      cursor: undefined,
    });
  });

  it('fails when both cursors are set', () => {
    const page = unwrap(keysetPaginate(rows, { limit: 5 }, newestFirst));
    const result = keysetPaginate(
      rows,
      { limit: 5, after: page.nextCursor, before: page.nextCursor },
      newestFirst,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe(KeysetCursorErrors.afterAndBeforeCode);
      expect(result.errors[0]?.type).toBe('Validation');
      expect(result.errors[0]?.metadata).toBeUndefined();
      expect(result.errors[0]?.description).toBe(
        "Only one of the 'after' and 'before' cursors can be set.",
      );
    }
  });

  it('treats empty cursor strings as absent', () => {
    const page = unwrap(keysetPaginate(rows, { limit: 5, after: '', before: '' }, newestFirst));
    expect(page.hasPrevious).toBe(false);
  });

  it.each(['garbage', 'eyJ2IjoxfQ'])('fails with InvalidCursor for %s', (cursor) => {
    const result = keysetPaginate(rows, { limit: 5, before: cursor }, newestFirst);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe(KeysetCursorErrors.invalidCode);
  });

  it('rejects cursors longer than maxCursorLength', () => {
    const page = unwrap(keysetPaginate(rows, { limit: 5 }, newestFirst));
    const cursor = page.nextCursor as string;
    const tooLong = keysetPaginate(rows, { limit: 5, after: cursor }, newestFirst, {
      maxCursorLength: cursor.length - 1,
    });
    const defaultCap = keysetPaginate(
      rows,
      { limit: 5, before: 'A'.repeat(KEYSET_DEFAULTS.maxCursorLength + 1) },
      newestFirst,
    );
    expect(!tooLong.ok && tooLong.errors[0]?.code).toBe(KeysetCursorErrors.invalidCode);
    expect(!defaultCap.ok && defaultCap.errors[0]?.code).toBe(KeysetCursorErrors.invalidCode);
    expect(!defaultCap.ok && defaultCap.errors[0]?.metadata?.get('parameter')).toBe('before');
  });

  it('walks past infinite and NaN number keys', () => {
    const scored: Row[] = [
      ...rows.slice(0, 5),
      { ...(rows[5] as Row), id: 1001, score: Number.POSITIVE_INFINITY },
      { ...(rows[6] as Row), id: 1002, score: Number.NEGATIVE_INFINITY },
      { ...(rows[7] as Row), id: 1003, score: Number.POSITIVE_INFINITY },
      { ...(rows[8] as Row), id: 1004, score: Number.NaN },
    ];
    const ordering = keysetOrdering<Row>('Row')
      .descending('score', 'number')
      .ascending('id', 'number');
    const { forward, backward } = walk(ordering, 2, scored);
    expect(forward).toEqual(expectedOrder(ordering, scored));
    expect(forward.slice(0, 2)).toEqual([1001, 1003]);
    expect(forward[forward.length - 1]).toBe(1004); // NaN sorts below -Infinity
    expect(backward).toEqual(forward);
  });

  it('walks bigint keys', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: 9_007_199_254_740_993n + BigInt(i) }));
    const ordering = keysetOrdering<{ id: bigint }>('Big').descending('id', 'bigint');
    let page = unwrap(keysetPaginate(items, { limit: 3 }, ordering));
    const seen = [...page.items];
    while (page.nextCursor !== undefined) {
      page = unwrap(keysetPaginate(items, { limit: 3, after: page.nextCursor }, ordering));
      seen.push(...page.items);
    }
    expect(seen.map((x) => x.id)).toEqual([...items].reverse().map((x) => x.id));
  });

  it('fails with KeyMismatch for a cursor from another ordering', () => {
    const other = keysetOrdering<Row>('Row').ascending('id', 'number');
    const page = unwrap(keysetPaginate(rows, { limit: 5 }, other));
    const result = keysetPaginate(rows, { limit: 5, after: page.nextCursor }, newestFirst);
    expect(!result.ok && result.errors[0]?.code).toBe(KeysetCursorErrors.keyMismatchCode);
  });

  it('fails with DirectionMismatch when a next cursor is sent as before', () => {
    const page = unwrap(keysetPaginate(rows, { limit: 5 }, newestFirst));
    const result = keysetPaginate(rows, { limit: 5, before: page.nextCursor }, newestFirst);
    expect(!result.ok && result.errors[0]?.code).toBe(KeysetCursorErrors.directionMismatchCode);
    expect(!result.ok && result.errors[0]?.description).toBe(
      "The 'before' cursor was issued for the other paging direction.",
    );
  });

  it('protects cursors with a custom protector', () => {
    const protector: CursorProtector = {
      protect: (c) => `p.${c}`,
      tryUnprotect: (c) => (c.startsWith('p.') ? c.slice(2) : undefined),
    };
    const page = unwrap(keysetPaginate(rows, { limit: 5 }, newestFirst, { protector }));
    expect(page.nextCursor?.startsWith('p.')).toBe(true);
    const next = keysetPaginate(rows, { limit: 5, after: page.nextCursor }, newestFirst, {
      protector,
    });
    expect(next.ok).toBe(true);
    const unprotected = keysetPaginate(
      rows,
      { limit: 5, after: page.nextCursor?.slice(2) },
      newestFirst,
      { protector },
    );
    expect(!unprotected.ok && unprotected.errors[0]?.code).toBe(KeysetCursorErrors.invalidCode);
  });

  it('throws for an empty ordering, a null key or invalid options', () => {
    expect(() => keysetPaginate(rows, {}, keysetOrdering<Row>('Row'))).toThrow(TypeError);
    const byMissing = keysetOrdering<Row>('Row').ascending('missing', 'number');
    expect(() => keysetPaginate(rows, {}, byMissing)).toThrow(
      "Keyset key 'missing' evaluated to null",
    );
    expect(() => keysetPaginate(rows, {}, newestFirst, { maxLimit: 0 })).toThrow(RangeError);
    expect(() => keysetPaginate(rows, {}, newestFirst, { maxLimit: 2_147_483_647 })).toThrow(
      RangeError,
    );
    expect(() => keysetPaginate(rows, {}, newestFirst, { maxCursorLength: 0 })).toThrow(RangeError);
  });
});

describe('encodeCursor / decodeCursor', () => {
  const byId = keysetOrdering<{ id: number }>('Item').ascending('id', 'number');
  const fp = byId.fingerprint;
  const raw = (payload: unknown): string =>
    Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );

  it('round-trips values of every kind', () => {
    const ordering = keysetOrdering<Record<string, unknown>>('All')
      .ascending('n', 'number')
      .ascending('s', 'string')
      .descending('d', 'date')
      .ascending('b', 'bigint');
    const item = {
      n: -1.5,
      s: 'héllo "x"',
      d: new Date('2024-06-15T10:20:30.123Z'),
      b: -12345678901234567890n,
    };
    const cursor = unwrap(encodeCursor(ordering, item, 'after'));
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(unwrap(decodeCursor(ordering, cursor, 'after'))).toEqual([
      item.n,
      item.s,
      item.d,
      item.b,
    ]);
  });

  it('writes the documented payload layout', () => {
    const cursor = unwrap(encodeCursor(byId, { id: 42 }, 'before'));
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual({
      v: 1,
      d: 'b',
      k: fp,
      p: [42],
    });
  });

  it('writes non-finite numbers as strings', () => {
    const cursor = unwrap(encodeCursor(byId, { id: Number.NEGATIVE_INFINITY }, 'after'));
    expect(Buffer.from(cursor, 'base64url').toString('utf8')).toContain('"p":["-Infinity"]');
    expect(unwrap(decodeCursor(byId, cursor, 'after'))).toEqual([Number.NEGATIVE_INFINITY]);
  });

  it('fails to encode null or mistyped values and empty orderings', () => {
    const nullResult = encodeCursor(byId, { id: null as unknown as number }, 'after');
    expect(!nullResult.ok && nullResult.errors[0]?.code).toBe(
      KeysetCursorErrors.invalidKeyValueCode,
    );
    const typed = encodeCursor(byId, { id: '1' as unknown as number }, 'after');
    expect(!typed.ok && typed.errors[0]?.code).toBe(KeysetCursorErrors.invalidKeyValueCode);
    const invalidCode = (r: Result<string>) => !r.ok && r.errors[0]?.code;
    const asString = keysetOrdering<{ v: unknown }>('V').ascending('v', 'string');
    const asDate = keysetOrdering<{ v: unknown }>('V').ascending('v', 'date');
    const asBigint = keysetOrdering<{ v: unknown }>('V').ascending('v', 'bigint');
    expect(invalidCode(encodeCursor(asString, { v: 1 }, 'after'))).toBe(
      KeysetCursorErrors.invalidKeyValueCode,
    );
    expect(invalidCode(encodeCursor(asDate, { v: new Date(Number.NaN) }, 'after'))).toBe(
      KeysetCursorErrors.invalidKeyValueCode,
    );
    expect(invalidCode(encodeCursor(asDate, { v: '2024-01-01' }, 'after'))).toBe(
      KeysetCursorErrors.invalidKeyValueCode,
    );
    expect(invalidCode(encodeCursor(asBigint, { v: 1 }, 'after'))).toBe(
      KeysetCursorErrors.invalidKeyValueCode,
    );
    const empty = encodeCursor(keysetOrdering<{ id: number }>('Item'), { id: 1 }, 'after');
    expect(empty.ok).toBe(false);
  });

  it('always returns a failure, even when a non-Error value is thrown', () => {
    const descriptionOf = (r: Result<string>) => (!r.ok ? r.errors[0]?.description : undefined);
    const codeOf = (r: Result<string>) => (!r.ok ? r.errors[0]?.code : undefined);
    const throwing = (value: unknown) => {
      const item = {
        get id(): number {
          throw value;
        },
      };
      return encodeCursor(byId, item, 'after');
    };
    for (const thrown of [null, undefined, 'boom', Object.create(null)]) {
      expect(codeOf(throwing(thrown))).toBe(KeysetCursorErrors.invalidKeyValueCode);
    }
    expect(descriptionOf(throwing(null))).toBe('null');
    expect(descriptionOf(throwing('boom'))).toBe('boom');
    expect(descriptionOf(throwing(Object.create(null)))).toBe('[object Object]');

    const protector: CursorProtector = {
      protect: () => {
        throw null;
      },
      tryUnprotect: () => undefined,
    };
    const r = encodeCursor(byId, { id: 1 }, 'after', protector);
    expect(codeOf(r)).toBe(KeysetCursorErrors.invalidKeyValueCode);
    expect(descriptionOf(r)).toBe('null');
  });

  const code = (cursor: string, direction: 'after' | 'before' = 'after') => {
    const r = decodeCursor(byId, cursor, direction);
    return r.ok ? 'ok' : r.errors[0]?.code;
  };

  it.each([
    ['empty string', ''],
    ['length % 4 == 1', 'AAAAA'],
    ['standard base64 chars', `${raw({ v: 1, d: 'a', k: fp, p: [1] })}+`],
    ['padding', `${raw({ v: 1 })}=`],
    ['invalid utf-8', Buffer.from([0x7b, 0xff, 0x7d]).toString('base64url')],
    ['not json', raw('not json')],
    ['json array', raw([1, 2])],
    ['json string', raw('"x"')],
    ['missing version', raw({ d: 'a', k: fp, p: [1] })],
    ['string version', raw({ v: '1', d: 'a', k: fp, p: [1] })],
    ['missing direction', raw({ v: 1, k: fp, p: [1] })],
    ['numeric key', raw({ v: 1, d: 'a', k: 1, p: [1] })],
    ['object payload', raw({ v: 1, d: 'a', k: fp, p: {} })],
    ['null value', raw({ v: 1, d: 'a', k: fp, p: [null] })],
    ['string for number', raw({ v: 1, d: 'a', k: fp, p: ['1'] })],
  ])('InvalidCursor: %s', (_, cursor) => {
    expect(code(cursor)).toBe(KeysetCursorErrors.invalidCode);
  });

  it('InvalidCursor: a number payload that overflows to Infinity', () => {
    expect(code(raw(`{"v":1,"d":"a","k":"${fp}","p":[1e999]}`))).toBe(
      KeysetCursorErrors.invalidCode,
    );
  });

  it.each([
    ['string', 5],
    ['date', 5],
    ['bigint', 5],
  ] as const)('InvalidCursor: a non-string value for a %s key', (kind, value) => {
    const ordering = keysetOrdering<{ v: unknown }>('V').ascending('v', kind);
    const cursor = raw({ v: 1, d: 'a', k: ordering.fingerprint, p: [value] });
    const r = decodeCursor(ordering, cursor, 'after');
    expect(!r.ok && r.errors[0]?.code).toBe(KeysetCursorErrors.invalidCode);
  });

  it.each([2, 0, 1.5])('UnsupportedCursorVersion: v=%d', (v) => {
    expect(code(raw({ v, d: 'a', k: fp, p: [1] }))).toBe(KeysetCursorErrors.unsupportedVersionCode);
  });

  it('checks version before direction, direction before keys, keys before values', () => {
    expect(code(raw({ v: 2, d: 'x', k: 'nope', p: [null] }))).toBe(
      KeysetCursorErrors.unsupportedVersionCode,
    );
    expect(code(raw({ v: 1, d: 'b', k: 'nope', p: [null] }))).toBe(
      KeysetCursorErrors.directionMismatchCode,
    );
    expect(code(raw({ v: 1, d: 'a', k: 'nope', p: [null] }))).toBe(
      KeysetCursorErrors.keyMismatchCode,
    );
    expect(code(raw({ v: 1, d: 'a', k: fp, p: [1, 2] }))).toBe(KeysetCursorErrors.keyMismatchCode);
    expect(code(raw({ v: 1, d: 'a', k: fp, p: [1] }))).toBe('ok');
  });

  it('validates date and bigint values', () => {
    const ordering = keysetOrdering<Record<string, unknown>>('D')
      .ascending('d', 'date')
      .ascending('b', 'bigint');
    const k = ordering.fingerprint;
    const decode = (p: unknown[]) => decodeCursor(ordering, raw({ v: 1, d: 'a', k, p }), 'after');
    expect(decode(['2024-06-15T10:00:00Z', '-12']).ok).toBe(true);
    expect(decode(['June 15, 2024', '1']).ok).toBe(false);
    expect(decode(['2024-13-45T10:00:00Z', '1']).ok).toBe(false);
    expect(decode(['2024-06-15', '1.5']).ok).toBe(false);
    expect(decode(['2024-06-15', 1]).ok).toBe(false);
  });

  it('rejects out-of-range date components instead of rolling them over', () => {
    const ordering = keysetOrdering<Record<string, unknown>>('D').ascending('d', 'date');
    const k = ordering.fingerprint;
    const decode = (d: unknown) =>
      decodeCursor(ordering, raw({ v: 1, d: 'a', k, p: [d] }), 'after');
    for (const bad of [
      '2024-02-30T10:00:00Z',
      '2023-02-29',
      '2024-04-31T00:00:00Z',
      '2024-00-10',
      '2024-06-00',
      '2024-06-15T24:00:00Z',
      '2024-06-15T10:60:00Z',
      '2024-06-15T10:00:60Z',
      '2024-06-15T10:00:00+24:00',
      '2024-06-15T10:00:00+05:60',
    ]) {
      expect(decode(bad).ok, bad).toBe(false);
    }
    expect(unwrap(decode('2024-02-29T23:59:59.999Z'))).toEqual([
      new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 999)),
    ]);
    expect(unwrap(decode('2024-06-15T10:00:00+03:00'))).toEqual([
      new Date(Date.UTC(2024, 5, 15, 7)),
    ]);
  });

  it('reads date values without an offset as UTC, never as host local time', () => {
    const ordering = keysetOrdering<Record<string, unknown>>('D').ascending('d', 'date');
    const k = ordering.fingerprint;
    const decode = (d: unknown) =>
      decodeCursor(ordering, raw({ v: 1, d: 'a', k, p: [d] }), 'after');
    expect(unwrap(decode('2024-06-15T10:20:30.5'))).toEqual([
      new Date(Date.UTC(2024, 5, 15, 10, 20, 30, 500)),
    ]);
    expect(unwrap(decode('2024-06-15T10:20'))).toEqual([new Date(Date.UTC(2024, 5, 15, 10, 20))]);
    expect(unwrap(decode('2024-06-15'))).toEqual([new Date(Date.UTC(2024, 5, 15))]);
  });

  it('accepts expanded years with the same strict validation', () => {
    const ordering = keysetOrdering<Record<string, unknown>>('D').ascending('d', 'date');
    const k = ordering.fingerprint;
    const decode = (d: unknown) =>
      decodeCursor(ordering, raw({ v: 1, d: 'a', k, p: [d] }), 'after');
    const at = (year: number, month = 0, day = 1) => {
      const date = new Date(0);
      date.setUTCFullYear(year, month, day);
      return date;
    };
    expect(unwrap(decode('+010000-01-01T00:00:00.000Z'))).toEqual([at(10000)]);
    expect(unwrap(decode('-000001-01-01T00:00:00.000Z'))).toEqual([at(-1)]);
    expect(unwrap(decode('+002024-06-15'))).toEqual([at(2024, 5, 15)]);
    expect(unwrap(decode('-000004-02-29T00:00'))).toEqual([at(-4, 1, 29)]);
    expect(unwrap(decode('+275760-09-13T00:00:00.000Z'))).toEqual([new Date(8.64e15)]);
    for (const bad of [
      '-000000-01-01',
      '+10000-01-01',
      '010000-01-01',
      '+0100000-01-01',
      '-000003-02-29',
      '+010000-01-01T24:00:00Z',
      '+275760-09-13T00:00:00.001Z',
      '+275760-09-13T00:00:00-01:00',
      '+275761-01-01',
    ]) {
      expect(decode(bad).ok, bad).toBe(false);
    }
  });

  it.each([
    ['year 10000', 10000],
    ['year -1', -1],
    ['year 0', 0],
  ])('round-trips a date key in %s through keysetPaginate', (_, year) => {
    type Event = { id: number; at: Date };
    const base = new Date(0);
    base.setUTCFullYear(year, 0, 1);
    const events: Event[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      at: new Date(base.getTime() + i * 86_400_000),
    }));
    const byAt = keysetOrdering<Event>('Event').ascending('at', 'date').ascending('id', 'number');
    const first = unwrap(keysetPaginate(events, { limit: 2 }, byAt));
    expect(first.items.map((e) => e.id)).toEqual([1, 2]);
    const second = unwrap(keysetPaginate(events, { limit: 2, after: first.nextCursor }, byAt));
    expect(second.items.map((e) => e.id)).toEqual([3, 4]);
    const back = unwrap(keysetPaginate(events, { limit: 2, before: second.previousCursor }, byAt));
    expect(back.items.map((e) => e.id)).toEqual([1, 2]);
  });

  it('maps a throwing protector to InvalidCursor', () => {
    const protector: CursorProtector = {
      protect: (cursor) => cursor,
      tryUnprotect: () => {
        throw new Error('bad signature');
      },
    };
    const cursor = unwrap(encodeCursor(byId, { id: 1 }, 'after'));
    const r = decodeCursor(byId, cursor, 'after', { protector });
    expect(!r.ok && r.errors[0]?.code).toBe(KeysetCursorErrors.invalidCode);
    const page = keysetPaginate([{ id: 1 }, { id: 2 }], { after: cursor }, byId, { protector });
    expect(!page.ok && page.errors[0]?.code).toBe(KeysetCursorErrors.invalidCode);
  });

  it('puts the cursor parameter in the error metadata', () => {
    const r = decodeCursor(byId, 'garbage!', 'before');
    expect(!r.ok && r.errors[0]?.description).toBe(
      "The 'before' cursor is malformed or has been tampered with.",
    );
    expect(!r.ok && r.errors[0]?.metadata?.get(KeysetCursorErrors.parameterKey)).toBe('before');
  });
});

describe('createKeysetPageResponse', () => {
  it('builds a page from rows fetched by a custom source', () => {
    const plan = unwrap(planKeysetPage({ limit: 2 }, newestFirst));
    const fetched = [...rows]
      .sort((a, b) =>
        compareKeyset(newestFirst, [a.createdAt, a.id], [b.createdAt, b.id], plan.reverse),
      )
      .slice(0, plan.take);
    const page = createKeysetPageResponse(fetched, plan, newestFirst);
    expect(page.items).toHaveLength(2);
    expect(page.hasNext).toBe(true);
    expect(page.hasPrevious).toBe(false);
  });
});
