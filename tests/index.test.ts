import {
  // maybe
  asMaybe,
  type Cloneable,
  chain,
  choose,
  // clone
  cloneArray,
  createEntityBase,
  createFakeDateTimeProvider,
  createSoftDeletable,
  deepClone,
  Err,
  ErrorMetadata,
  ErrorType,
  // http
  fetchResult,
  httpStatusToError,
  Maybe,
  // result
  maybeToResult,
  RequestBuilder,
  Result,
  ResultChain,
  ResultUnwrapError,
  RuleEngine,
  resultToMaybe,
  SystemDateTimeProvider,
  tryFind,
  tryFirst,
  tryLast,
  // union
  Union,
} from '~/index';

describe('index exports', () => {
  it('exports clone utilities', () => {
    expect(typeof cloneArray).toBe('function');
    expect(typeof deepClone).toBe('function');
  });

  it('exports entity utilities', () => {
    expect(typeof createEntityBase).toBe('function');
    expect(typeof createSoftDeletable).toBe('function');
  });

  it('exports error utilities', () => {
    expect(typeof Err.failure).toBe('function');
    expect(typeof Err.validation).toBe('function');
    expect(typeof ErrorMetadata.empty).toBe('function');
    expect(typeof ErrorType.Failure).toBe('string');
  });

  it('exports HTTP utilities', () => {
    expect(typeof fetchResult.get).toBe('function');
    expect(typeof RequestBuilder).toBe('function');
    expect(typeof httpStatusToError).toBe('function');
  });

  it('exports Maybe utilities', () => {
    expect(typeof Maybe.some).toBe('function');
    expect(typeof Maybe.none).toBe('function');
    expect(typeof asMaybe).toBe('function');
    expect(typeof choose).toBe('function');
    expect(typeof tryFind).toBe('function');
    expect(typeof tryFirst).toBe('function');
    expect(typeof tryLast).toBe('function');
  });

  it('exports Result utilities', () => {
    expect(typeof Result.success).toBe('function');
    expect(typeof Result.failure).toBe('function');
    expect(typeof maybeToResult).toBe('function');
    expect(typeof resultToMaybe).toBe('function');
    expect(typeof ResultUnwrapError).toBe('function');
    expect(typeof chain).toBe('function');
    expect(typeof ResultChain).toBe('function');
  });

  it('exports Rule utilities', () => {
    expect(typeof RuleEngine.fromPredicate).toBe('function');
    expect(typeof RuleEngine.and).toBe('function');
    expect(typeof RuleEngine.evaluate).toBe('function');
  });

  it('exports time utilities', () => {
    expect(typeof SystemDateTimeProvider.utcNow).toBe('function');
    expect(typeof createFakeDateTimeProvider).toBe('function');
  });

  it('exports Union utilities', () => {
    expect(typeof Union.of).toBe('function');
    expect(typeof Union.match).toBe('function');
    expect(typeof Union.is).toBe('function');
    expect(typeof Union.get).toBe('function');
  });

  it('all type exports are importable (compile-time check)', () => {
    // If this test compiles, type exports are correct.
    // Runtime assertions just verify the values exist where applicable.
    expect(true).toBe(true);
  });
});

describe('index runtime integration', () => {
  it('can create and use EntityBase', () => {
    const entity = createEntityBase();
    entity.setCreatedInfo(new Date('2024-01-01'), 'system');
    expect(entity.createdBy).toBe('system');
  });

  it('can create and use SoftDeletable', () => {
    const sd = createSoftDeletable();
    expect(sd.isDeleted).toBe(false);
    sd.markAsDeleted(new Date(), 'admin');
    expect(sd.isDeleted).toBe(true);
  });

  it('can create and use Result pipeline', () => {
    const r = Result.success(5);
    const mapped = Result.map(r, (n) => n * 2);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.value).toBe(10);
  });

  it('can create and use Maybe pipeline', () => {
    const m = Maybe.from('hello');
    const mapped = Maybe.map(m, (s) => s.toUpperCase());
    expect(mapped.hasValue).toBe(true);
    if (mapped.hasValue) expect(mapped.value).toBe('HELLO');
  });

  it('can bridge Maybe and Result', () => {
    const maybe = Maybe.some(42);
    const result = maybeToResult(maybe, Err.notFound('Test', 'Not found'));
    expect(result.ok).toBe(true);

    const maybe2 = resultToMaybe(Result.failure(Err.validation('Test', 'Bad')));
    expect(maybe2.hasValue).toBe(false);
  });

  it('can use RuleEngine', () => {
    const rule = RuleEngine.fromPredicate<number>(
      (n) => n > 0,
      Err.validation('Test', 'Must be positive'),
    );
    expect(rule(5).ok).toBe(true);
    expect(rule(-1).ok).toBe(false);
  });

  it('can use Union', () => {
    const u = Union.of<{ a: number; b: string }>('a', 42);
    const result = Union.match(u, {
      a: (n) => n * 2,
      b: (s) => s.length,
    });
    expect(result).toBe(84);
  });

  it('can use deepClone', () => {
    const original = { nested: { array: [1, 2, 3] } };
    const cloned = deepClone(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.nested).not.toBe(original.nested);
  });

  it('can use cloneArray with Cloneable items', () => {
    class Item implements Cloneable<Item> {
      constructor(public readonly id: number) {}
      clone(): Item {
        return new Item(this.id);
      }
    }
    const items = [new Item(1), new Item(2)];
    const cloned = cloneArray(items);
    expect(cloned).toHaveLength(2);
    expect(cloned[0]!.id).toBe(1);
    expect(cloned[0]).not.toBe(items[0]);
  });

  it('can use SystemDateTimeProvider', () => {
    const now = SystemDateTimeProvider.utcNow();
    expect(now).toBeInstanceOf(Date);
    expect(typeof SystemDateTimeProvider.utcNowMs()).toBe('number');
    const today = SystemDateTimeProvider.utcNowDate();
    expect(today.getUTCHours()).toBe(0);
    expect(today.getUTCMinutes()).toBe(0);
    expect(today.getUTCSeconds()).toBe(0);
    expect(today.getUTCMilliseconds()).toBe(0);
  });

  it('can use createFakeDateTimeProvider', () => {
    const fake = createFakeDateTimeProvider(new Date('2024-06-01T12:00:00Z'));
    expect(fake.utcNow()).toEqual(new Date('2024-06-01T12:00:00Z'));
    fake.advance(1000);
    expect(fake.utcNow()).toEqual(new Date('2024-06-01T12:00:01Z'));
    fake.setTime(new Date('2024-01-01T00:00:00Z'));
    expect(fake.utcNow()).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  it('can use httpStatusToError', () => {
    const err = httpStatusToError(404, 'Not found');
    expect(err.code).toBe('Http.404');
    expect(err.type).toBe(ErrorType.NotFound);
  });

  it('can use ErrorMetadata', () => {
    const meta = ErrorMetadata.fromRecord({ key: 'value' });
    expect(meta.get('key')).toBe('value');
    const record = ErrorMetadata.toRecord(meta);
    expect(record).toEqual({ key: 'value' });
  });
});
