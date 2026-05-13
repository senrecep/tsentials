import { Maybe } from '../../src/maybe/maybe.js';

describe('Maybe factories', () => {
  it('some creates a value', () => {
    const m = Maybe.some(42);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(42);
  });

  it('none creates empty', () => {
    const m = Maybe.none<number>();
    expect(m.hasValue).toBe(false);
  });

  it('from wraps non-null value', () => {
    expect(Maybe.from('hello').hasValue).toBe(true);
  });

  it('from returns none for null', () => {
    expect(Maybe.from(null).hasValue).toBe(false);
  });

  it('from returns none for undefined', () => {
    expect(Maybe.from(undefined).hasValue).toBe(false);
  });

  it('from returns none for NaN (NaN != null)', () => {
    expect(Maybe.from(Number.NaN).hasValue).toBe(true); // NaN != null, so it becomes Some
  });

  it('fromTry catches thrown errors as None', () => {
    const m = Maybe.fromTry(() => {
      throw new Error();
    });
    expect(m.hasValue).toBe(false);
  });

  it('fromTry returns Some for successful factory', () => {
    const m = Maybe.fromTry(() => 'value');
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe('value');
  });

  it('fromTry returns None when factory returns null', () => {
    const m = Maybe.fromTry(() => null);
    expect(m.hasValue).toBe(false);
  });
});

describe('Maybe type guards', () => {
  it('isSome returns true for Some', () => {
    expect(Maybe.isSome(Maybe.some(1))).toBe(true);
  });

  it('isSome returns false for None', () => {
    expect(Maybe.isSome(Maybe.none<number>())).toBe(false);
  });

  it('isNone returns true for None', () => {
    expect(Maybe.isNone(Maybe.none<number>())).toBe(true);
  });

  it('isNone returns false for Some', () => {
    expect(Maybe.isNone(Maybe.some(1))).toBe(false);
  });
});

describe('Maybe pipeline', () => {
  it('map transforms value', () => {
    const m = Maybe.map(Maybe.some(5), (n) => n * 3);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(15);
  });

  it('map passes through none', () => {
    const m = Maybe.map(Maybe.none<number>(), (n) => n * 3);
    expect(m.hasValue).toBe(false);
  });

  it('bind chains maybe', () => {
    const m = Maybe.bind(Maybe.some(5), (n) => Maybe.from(n > 3 ? n : null));
    expect(m.hasValue).toBe(true);
  });

  it('bind returns none when predicate fails', () => {
    const m = Maybe.bind(Maybe.some(2), (n) => Maybe.from(n > 3 ? n : null));
    expect(m.hasValue).toBe(false);
  });

  it('tap runs side effect on Some', () => {
    const seen: number[] = [];
    const m = Maybe.tap(Maybe.some(7), (n) => seen.push(n));
    expect(seen).toEqual([7]);
    expect(m.hasValue).toBe(true);
  });

  it('tap skips on None', () => {
    const seen: number[] = [];
    Maybe.tap(Maybe.none<number>(), (n) => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  it('match handles some', () => {
    const result = Maybe.match(
      Maybe.some(10),
      (v) => `value:${v}`,
      () => 'none',
    );
    expect(result).toBe('value:10');
  });

  it('match handles none', () => {
    const result = Maybe.match(
      Maybe.none<number>(),
      (v) => `value:${v}`,
      () => 'none',
    );
    expect(result).toBe('none');
  });

  it('getOrDefault returns value when some', () => {
    expect(Maybe.getOrDefault(Maybe.some(42), 0)).toBe(42);
  });

  it('getOrDefault returns default when none', () => {
    expect(Maybe.getOrDefault(Maybe.none<number>(), 99)).toBe(99);
  });

  it('getOrThrow throws when none', () => {
    expect(() => Maybe.getOrThrow(Maybe.none<number>())).toThrow();
  });

  it('getOrThrow returns value when some', () => {
    expect(Maybe.getOrThrow(Maybe.some(42))).toBe(42);
  });

  it('getOrThrow uses custom message', () => {
    expect(() => Maybe.getOrThrow(Maybe.none<number>(), 'Custom message')).toThrow(
      'Custom message',
    );
  });

  it('getOrUndefined returns value when some', () => {
    expect(Maybe.getOrUndefined(Maybe.some(42))).toBe(42);
  });

  it('getOrUndefined returns undefined when none', () => {
    expect(Maybe.getOrUndefined(Maybe.none<number>())).toBeUndefined();
  });

  it('filter keeps value when predicate passes', () => {
    const m = Maybe.filter(Maybe.some(10), (n) => n > 5);
    expect(m.hasValue).toBe(true);
  });

  it('filter returns none when predicate fails', () => {
    const m = Maybe.filter(Maybe.some(3), (n) => n > 5);
    expect(m.hasValue).toBe(false);
  });

  it('filter passes through none', () => {
    const called: boolean[] = [];
    const m = Maybe.filter(Maybe.none<number>(), (n) => {
      called.push(true);
      return n > 5;
    });
    expect(m.hasValue).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('getOrElse returns value when some', () => {
    expect(Maybe.getOrElse(Maybe.some(42), () => 0)).toBe(42);
  });

  it('getOrElse calls factory when none', () => {
    const called: boolean[] = [];
    const v = Maybe.getOrElse(Maybe.none<number>(), () => {
      called.push(true);
      return 99;
    });
    expect(v).toBe(99);
    expect(called).toHaveLength(1);
  });

  it('deconstruct returns [true, value] for Some', () => {
    const [hasValue, value] = Maybe.deconstruct(Maybe.some(42));
    expect(hasValue).toBe(true);
    expect(value).toBe(42);
  });

  it('deconstruct returns [false, undefined] for None', () => {
    const [hasValue, value] = Maybe.deconstruct(Maybe.none<number>());
    expect(hasValue).toBe(false);
    expect(value).toBeUndefined();
  });
});

describe('Maybe async pipeline', () => {
  it('mapAsync transforms value', async () => {
    const m = await Maybe.mapAsync(Maybe.some(5), async (n) => n * 3);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(15);
  });

  it('mapAsync passes through none', async () => {
    const m = await Maybe.mapAsync(Maybe.none<number>(), async (n) => n * 3);
    expect(m.hasValue).toBe(false);
  });

  it('bindAsync chains maybe', async () => {
    const m = await Maybe.bindAsync(Maybe.some(5), async (n) =>
      n > 3 ? Maybe.some(n) : Maybe.none<number>(),
    );
    expect(m.hasValue).toBe(true);
  });

  it('bindAsync returns none when fn returns none', async () => {
    const m = await Maybe.bindAsync(Maybe.some(2), async (n) =>
      n > 3 ? Maybe.some(n) : Maybe.none<number>(),
    );
    expect(m.hasValue).toBe(false);
  });

  it('bindAsync passes through none', async () => {
    const called: boolean[] = [];
    const m = await Maybe.bindAsync(Maybe.none<number>(), async (n) => {
      called.push(true);
      return Maybe.some(n);
    });
    expect(m.hasValue).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('tapAsync runs effect when some', async () => {
    const seen: number[] = [];
    const m = await Maybe.tapAsync(Maybe.some(7), async (n) => {
      seen.push(n);
    });
    expect(seen).toEqual([7]);
    expect(m.hasValue).toBe(true);
  });

  it('tapAsync skips when none', async () => {
    const seen: number[] = [];
    await Maybe.tapAsync(Maybe.none<number>(), async (n) => {
      seen.push(n);
    });
    expect(seen).toHaveLength(0);
  });

  it('matchAsync handles some', async () => {
    const result = await Maybe.matchAsync(
      Maybe.some(10),
      async (v) => `value:${v}`,
      async () => 'none',
    );
    expect(result).toBe('value:10');
  });

  it('matchAsync handles none', async () => {
    const result = await Maybe.matchAsync(
      Maybe.none<number>(),
      async (v) => `value:${v}`,
      async () => 'none',
    );
    expect(result).toBe('none');
  });

  it('filterAsync keeps value when predicate resolves true', async () => {
    const m = await Maybe.filterAsync(Maybe.some(10), async (n) => n > 5);
    expect(m.hasValue).toBe(true);
  });

  it('filterAsync returns none when predicate resolves false', async () => {
    const m = await Maybe.filterAsync(Maybe.some(3), async (n) => n > 5);
    expect(m.hasValue).toBe(false);
  });

  it('filterAsync passes through none without calling predicate', async () => {
    const called: boolean[] = [];
    const m = await Maybe.filterAsync(Maybe.none<number>(), async (n) => {
      called.push(true);
      return n > 0;
    });
    expect(m.hasValue).toBe(false);
    expect(called).toHaveLength(0);
  });
});

describe('Maybe new methods', () => {
  // or
  it('or returns self when Some', () => {
    const m = Maybe.or(Maybe.some(1), Maybe.some(99));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(1);
  });

  it('or returns fallback when None', () => {
    const m = Maybe.or(Maybe.none<number>(), Maybe.some(99));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(99);
  });

  it('or returns None when both are None', () => {
    const m = Maybe.or(Maybe.none<number>(), Maybe.none<number>());
    expect(m.hasValue).toBe(false);
  });

  // orElse
  it('orElse returns self when Some', () => {
    const m = Maybe.orElse(Maybe.some(1), () => Maybe.some(99));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(1);
  });

  it('orElse calls fn and returns result when None', () => {
    const m = Maybe.orElse(Maybe.none<number>(), () => Maybe.some(99));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(99);
  });

  it('orElse factory is NOT called when Some (lazy)', () => {
    const called: boolean[] = [];
    Maybe.orElse(Maybe.some(1), () => {
      called.push(true);
      return Maybe.some(99);
    });
    expect(called).toHaveLength(0);
  });

  it('orElse returns None when factory returns None', () => {
    const m = Maybe.orElse(Maybe.none<number>(), () => Maybe.none<number>());
    expect(m.hasValue).toBe(false);
  });

  // orAsync
  it('orAsync returns self when Some', async () => {
    const m = await Maybe.orAsync(Maybe.some(1), async () => Maybe.some(99));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(1);
  });

  it('orAsync calls async fn when None', async () => {
    const m = await Maybe.orAsync(Maybe.none<number>(), async () => Maybe.some(99));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(99);
  });

  it('orAsync factory is NOT called when Some (lazy)', async () => {
    const called: boolean[] = [];
    await Maybe.orAsync(Maybe.some(1), async () => {
      called.push(true);
      return Maybe.some(99);
    });
    expect(called).toHaveLength(0);
  });

  // tapNone
  it('tapNone calls fn when None', () => {
    const called: boolean[] = [];
    Maybe.tapNone(Maybe.none<number>(), () => {
      called.push(true);
    });
    expect(called).toHaveLength(1);
  });

  it('tapNone skips fn when Some', () => {
    const called: boolean[] = [];
    Maybe.tapNone(Maybe.some(1), () => {
      called.push(true);
    });
    expect(called).toHaveLength(0);
  });

  it('tapNone returns the maybe unchanged', () => {
    const original = Maybe.some(42);
    const result = Maybe.tapNone(original, () => {
      /* no-op */
    });
    expect(result).toBe(original);
  });

  // mapIf
  it('mapIf transforms value when condition is true (boolean)', () => {
    const m = Maybe.mapIf(Maybe.some(5), true, (n) => n * 2);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(10);
  });

  it('mapIf passes through when condition is false', () => {
    const m = Maybe.mapIf(Maybe.some(5), false, (n) => n * 2);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(5);
  });

  it('mapIf uses predicate function as condition', () => {
    const m = Maybe.mapIf(
      Maybe.some(5),
      (n) => n > 3,
      (n) => n * 2,
    );
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(10);
  });

  it('mapIf skips transformation when predicate returns false', () => {
    const m = Maybe.mapIf(
      Maybe.some(5),
      (n) => n > 10,
      (n) => n * 2,
    );
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(5);
  });

  it('mapIf passes through None', () => {
    const m = Maybe.mapIf(Maybe.none<number>(), true, (n) => n * 2);
    expect(m.hasValue).toBe(false);
  });

  // bindIf
  it('bindIf binds when condition is true', () => {
    const m = Maybe.bindIf(Maybe.some(5), true, (n) => Maybe.some(n * 2));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(10);
  });

  it('bindIf passes through when condition is false', () => {
    const m = Maybe.bindIf(Maybe.some(5), false, (n) => Maybe.some(n * 2));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(5);
  });

  it('bindIf uses predicate function as condition', () => {
    const m = Maybe.bindIf(
      Maybe.some(5),
      (n) => n > 10,
      (n) => Maybe.some(n * 2),
    );
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(5);
  });

  it('bindIf passes through None', () => {
    const m = Maybe.bindIf(Maybe.none<number>(), true, (n) => Maybe.some(n * 2));
    expect(m.hasValue).toBe(false);
  });

  it('bindIf binds when predicate returns true', () => {
    const m = Maybe.bindIf(
      Maybe.some(15),
      (n) => n > 10,
      (n) => Maybe.some(n * 2),
    );
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(30);
  });
});
