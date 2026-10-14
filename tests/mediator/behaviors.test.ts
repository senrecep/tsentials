import { type AppError, Err, ErrorMetadata, ErrorType } from '../../src/errors/index.js';
import { Maybe } from '../../src/maybe/maybe.js';
import {
  type CacheStore,
  cachingBehavior,
  exceptionHandlingBehavior,
  InProcessResourceLock,
  jsonResultSerializer,
  type LockHandle,
  LockTimeoutError,
  lockBehavior,
  loggingBehavior,
  type MediatorLogLevel,
  type NextHandler,
  type RequestContext,
  type ResourceLock,
  type TransactionRunner,
  transactionBehavior,
} from '../../src/mediator/index.js';
import { Result } from '../../src/result/index.js';

const ctx = (signal?: AbortSignal): RequestContext => ({ requestName: 'GetUser', signal });

function nextOf<T>(fn: () => Result<T> | Promise<Result<T>>): NextHandler<unknown, T> {
  return async () => fn();
}

function memoryLogger(disabled: MediatorLogLevel[] = []) {
  const entries: { level: MediatorLogLevel; message: string; props: Record<string, unknown> }[] =
    [];
  return {
    entries,
    log: (level: MediatorLogLevel, message: string, props: Readonly<Record<string, unknown>>) => {
      entries.push({ level, message, props: { ...props } });
    },
    isEnabled: (level: MediatorLogLevel) => !disabled.includes(level),
  };
}

describe('exceptionHandlingBehavior', () => {
  const behavior = exceptionHandlingBehavior();

  it('passes successes and failures through', async () => {
    const failure = Result.failure<number>(Err.notFound('X', 'y'));
    expect(
      await behavior(
        1,
        nextOf(() => Result.success(1)),
        ctx(),
      ),
    ).toEqual(Result.success(1));
    expect(
      await behavior(
        1,
        nextOf(() => failure),
        ctx(),
      ),
    ).toBe(failure);
  });

  it('converts sync and async throws to Err.fromException', async () => {
    const r1 = await behavior(
      1,
      () => {
        throw new TypeError('sync');
      },
      ctx(),
    );
    const r2 = await behavior(
      1,
      nextOf(async () => {
        await Promise.resolve();
        throw new Error('after await');
      }),
      ctx(),
    );
    expect(r1.ok || r1.errors[0]).toMatchObject({
      code: 'TypeError',
      description: 'sync',
      type: ErrorType.Failure,
    });
    expect(r2.ok || r2.errors[0]).toMatchObject({ code: 'Error', description: 'after await' });
  });

  it('converts a thrown value String() rejects (no prototype) instead of rejecting', async () => {
    const r = await behavior(
      1,
      nextOf(() => {
        throw Object.create(null);
      }),
      ctx(),
    );
    expect(r.ok || r.errors[0]).toMatchObject({ code: 'Error', description: '[object Object]' });
  });

  it('propagates abort errors', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    await expect(
      behavior(
        1,
        nextOf(() => {
          throw abort;
        }),
        ctx(),
      ),
    ).rejects.toBe(abort);
    const controller = new AbortController();
    const reason = new Error('custom reason');
    controller.abort(reason);
    await expect(
      behavior(
        1,
        nextOf(() => {
          throw reason;
        }),
        ctx(controller.signal),
      ),
    ).rejects.toBe(reason);
  });
});

describe('loggingBehavior', () => {
  it('logs request, response and elapsed time without payloads by default', async () => {
    const logger = memoryLogger();
    let t = 0;
    const behavior = loggingBehavior({
      logger,
      now: () => {
        const current = t;
        t += 1500;
        return current;
      },
    });
    await behavior(
      { id: 1 },
      nextOf(() => Result.success('u')),
      ctx(),
    );
    expect(logger.entries.map((e) => e.message)).toEqual([
      'Handling GetUser request',
      'Handled Result response',
      'Request GetUser took 00:00:01.5000000',
    ]);
    expect(logger.entries.every((e) => e.level === 'information')).toBe(true);
    expect(logger.entries[2]?.props).toEqual({ RequestName: 'GetUser', ElapsedTime: 1500 });
  });

  it('logs payloads when enabled', async () => {
    const logger = memoryLogger();
    const behavior = loggingBehavior({
      logger,
      logRequest: true,
      logResponse: (req) => (req as { id: number }).id === 1,
      responseName: () => 'User',
    });
    await behavior(
      { id: 1 },
      nextOf(() => Result.success('u')),
      ctx(),
    );
    expect(logger.entries[0]?.message).toBe('Handling GetUser request: {"id":1}');
    expect(logger.entries[1]?.message).toBe('Handled User response: {"ok":true,"value":"u"}');
  });

  it('never throws when payloads are not JSON-serializable (BigInt, circular)', async () => {
    const logger = memoryLogger();
    const behavior = loggingBehavior({ logger, logRequest: true, logResponse: true });
    const circular: Record<string, unknown> = { name: 'c' };
    circular.self = circular;
    const r = await behavior(
      { id: 10n },
      nextOf(() => Result.success(circular)),
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(logger.entries[0]?.message).toBe('Handling GetUser request: {"id":"10"}');
    expect(logger.entries[1]?.message).toBe('Handled Result response: [object Object]');

    const bare = Object.create(null) as Record<string, unknown>;
    bare.self = bare;
    await behavior(
      bare,
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(logger.entries[3]?.message).toBe('Handling GetUser request: [object Object]');

    const hostile = {
      toJSON() {
        throw new Error('no json');
      },
      [Symbol.toPrimitive]() {
        throw new Error('no primitive');
      },
      get [Symbol.toStringTag](): string {
        throw new Error('no tag');
      },
    };
    await behavior(
      hostile,
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(logger.entries[6]?.message).toBe('Handling GetUser request: [unserializable]');
  });

  it('a throwing logger never fails the request', async () => {
    const throwingLog = {
      log: () => {
        throw new Error('logger down');
      },
    };
    const r1 = await loggingBehavior({ logger: throwingLog, logRequest: true, logResponse: true })(
      { id: 1 },
      nextOf(() => Result.success('u')),
      ctx(),
    );
    expect(r1).toEqual(Result.success('u'));

    let handled = 0;
    const throwingIsEnabled = {
      log: () => undefined,
      isEnabled: () => {
        throw new Error('isEnabled down');
      },
    };
    const r2 = await loggingBehavior({ logger: throwingIsEnabled, logRequest: true })(
      { id: 1 },
      nextOf(() => {
        handled++;
        return Result.success('v');
      }),
      ctx(),
    );
    expect(r2).toEqual(Result.success('v'));
    expect(handled).toBe(1);
  });

  it('a throwing logger does not swallow the handler error', async () => {
    const throwingLog = {
      log: () => {
        throw new Error('logger down');
      },
    };
    await expect(
      loggingBehavior({ logger: throwingLog })(
        { id: 1 },
        nextOf(() => {
          throw new Error('handler boom');
        }),
        ctx(),
      ),
    ).rejects.toThrow('handler boom');
  });

  it('logs null for a request that JSON cannot represent', async () => {
    const logger = memoryLogger();
    await loggingBehavior({ logger, logRequest: true })(
      undefined,
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(logger.entries[0]?.message).toBe('Handling GetUser request: null');
  });

  it('logs when the logger does not implement isEnabled', async () => {
    const messages: string[] = [];
    const logger = {
      log: (_level: MediatorLogLevel, message: string) => void messages.push(message),
    };
    await loggingBehavior({ logger, now: () => 0 })(
      1,
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(messages).toHaveLength(3);
    expect(messages[0]).toBe('Handling GetUser request');
  });

  it('serializes failed results with the AppError wire shape', async () => {
    const logger = memoryLogger();
    const behavior = loggingBehavior({ logger, logResponse: true });
    await behavior(
      1,
      nextOf(() => Result.failure(Err.validation('A', 'b'))),
      ctx(),
    );
    expect(logger.entries[1]?.message).toContain('"code":"A"');
  });

  it('logs nothing after the request when the pipeline throws', async () => {
    const logger = memoryLogger();
    const behavior = loggingBehavior({ logger });
    await expect(
      behavior(
        1,
        nextOf(() => {
          throw new Error('x');
        }),
        ctx(),
      ),
    ).rejects.toThrow('x');
    expect(logger.entries).toHaveLength(1);
  });

  it('skips disabled levels', async () => {
    const logger = memoryLogger(['information']);
    const toJSON = vi.fn(() => ({}));
    await loggingBehavior({ logger, logRequest: true })(
      { toJSON },
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(logger.entries).toHaveLength(0);
    expect(toJSON).not.toHaveBeenCalled();
  });
});

function memoryCache(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const sets: { key: string; value: string; options: { expirationMs?: number | undefined } }[] = [];
  const store: CacheStore = {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string, options) => {
      data.set(key, value);
      sets.push({ key, value, options });
    }),
  };
  return { store, data, sets };
}

describe('cachingBehavior', () => {
  const request = { cacheKey: 'user:1', expirationMs: 60_000 };

  it('returns the cached value on a hit without calling the handler', async () => {
    const { store } = memoryCache({ 'user:1': '{"ok":true,"value":"cached"}' });
    const logger = memoryLogger();
    const handler = vi.fn(() => Result.success('fresh'));
    const r = await cachingBehavior({ cache: store, logger })(request, nextOf(handler), ctx());
    expect(r).toEqual(Result.success('cached'));
    expect(handler).not.toHaveBeenCalled();
    expect(logger.entries.map((e) => e.message)).toEqual(['Cache hit for key user:1']);
  });

  it('calls the handler and stores the result on a miss', async () => {
    const { store, sets } = memoryCache();
    const logger = memoryLogger();
    const r = await cachingBehavior({ cache: store, logger })(
      request,
      nextOf(() => Result.success('fresh')),
      ctx(),
    );
    expect(r).toEqual(Result.success('fresh'));
    expect(sets).toEqual([
      { key: 'user:1', value: '{"ok":true,"value":"fresh"}', options: { expirationMs: 60_000 } },
    ]);
    expect(logger.entries.map((e) => e.message)).toEqual([
      'Cache miss for key user:1',
      'Cache set for key user:1',
    ]);
  });

  it('a throwing logger never fails the request on a hit or a miss', async () => {
    const logger = {
      log: () => {
        throw new Error('logger down');
      },
    };
    const hit = memoryCache({ 'user:1': '{"ok":true,"value":"cached"}' });
    const handler = vi.fn(() => Result.success('fresh'));
    expect(
      await cachingBehavior({ cache: hit.store, logger })(request, nextOf(handler), ctx()),
    ).toEqual(Result.success('cached'));
    expect(handler).not.toHaveBeenCalled();

    const miss = memoryCache();
    expect(
      await cachingBehavior({ cache: miss.store, logger })(
        request,
        nextOf(() => Result.success('fresh')),
        ctx(),
      ),
    ).toEqual(Result.success('fresh'));
    expect(miss.sets).toHaveLength(1);
  });

  it('treats an empty entry as a miss', async () => {
    const { store, sets } = memoryCache({ 'user:1': '' });
    await cachingBehavior({ cache: store })(
      request,
      nextOf(() => Result.success(1)),
      ctx(),
    );
    expect(sets).toHaveLength(1);
  });

  it('does not cache failures unless cacheFailures is set', async () => {
    const failure = () => Result.failure(Err.notFound('User.NotFound', 'missing'));
    const a = memoryCache();
    await cachingBehavior({ cache: a.store })(request, nextOf(failure), ctx());
    expect(a.sets).toHaveLength(0);

    const b = memoryCache();
    await cachingBehavior({ cache: b.store })(
      { ...request, cacheFailures: true },
      nextOf(failure),
      ctx(),
    );
    expect(b.sets).toHaveLength(1);
    const back = jsonResultSerializer.deserialize(b.sets[0]?.value ?? '');
    expect(back).toEqual(failure());
  });

  it('skips the lookup when bypassCache is set or the request is not cacheable', async () => {
    const { store } = memoryCache({ 'user:1': '{"ok":true,"value":"cached"}' });
    const behavior = cachingBehavior({ cache: store });
    expect(
      await behavior(
        { ...request, bypassCache: true },
        nextOf(() => Result.success('x')),
        ctx(),
      ),
    ).toEqual(Result.success('x'));
    expect(
      await behavior(
        { id: 1 },
        nextOf(() => Result.success('y')),
        ctx(),
      ),
    ).toEqual(Result.success('y'));
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('does not pass an expiration when it is zero or missing', async () => {
    const { store, sets } = memoryCache();
    await cachingBehavior({ cache: store })(
      { cacheKey: 'k', expirationMs: 0 },
      nextOf(() => Result.success(1)),
      ctx(),
    );
    expect(sets[0]?.options).toEqual({});
  });

  it('does not pass an expiration when the request has none', async () => {
    const { store, sets } = memoryCache();
    await cachingBehavior({ cache: store })(
      { cacheKey: 'k' },
      nextOf(() => Result.success(1)),
      ctx(),
    );
    expect(sets[0]?.options).toEqual({});
  });

  it('passes primitive requests through without touching the cache', async () => {
    const { store } = memoryCache();
    const r = await cachingBehavior({ cache: store })(
      'user:1',
      nextOf(() => Result.success(2)),
      ctx(),
    );
    expect(r).toEqual(Result.success(2));
    expect(store.get).not.toHaveBeenCalled();
  });

  it('throws when the cached value is not a result', async () => {
    const { store } = memoryCache({ 'user:1': 'null' });
    await expect(
      cachingBehavior({ cache: store })(
        request,
        nextOf(() => Result.success(1)),
        ctx(),
      ),
    ).rejects.toThrow('Failed to deserialize cached value for key user:1');
  });

  it('passes the signal to the cache', async () => {
    const { store } = memoryCache();
    const controller = new AbortController();
    await cachingBehavior({ cache: store })(
      request,
      nextOf(() => Result.success(1)),
      ctx(controller.signal),
    );
    expect(store.get).toHaveBeenCalledWith('user:1', controller.signal);
  });
});

describe('jsonResultSerializer', () => {
  it('round-trips errors with metadata and type', () => {
    const errors: AppError[] = [
      Err.conflict('A', 'a', ErrorMetadata.fromRecord({ n: 1 })),
      Err.unauthorized('B', 'b'),
    ];
    const r = Result.failureFrom(errors);
    expect(jsonResultSerializer.deserialize(jsonResultSerializer.serialize(r))).toEqual(r);
  });

  it('rejects unknown shapes', () => {
    expect(jsonResultSerializer.deserialize('{"ok":false,"errors":[]}')).toBeUndefined();
    expect(jsonResultSerializer.deserialize('{"ok":false,"errors":[{"code":1}]}')).toBeUndefined();
    expect(jsonResultSerializer.deserialize('"text"')).toBeUndefined();
    expect(jsonResultSerializer.deserialize('{"ok":false,"errors":[null]}')).toBeUndefined();
    expect(jsonResultSerializer.deserialize('{"ok":false,"errors":["E"]}')).toBeUndefined();
    expect(
      jsonResultSerializer.deserialize(
        '{"ok":false,"errors":[{"code":"A","description":"a","type":"Bogus"}]}',
      ),
    ).toBeUndefined();
    expect(() => jsonResultSerializer.deserialize('{bad')).toThrow(SyntaxError);
  });
});

describe('lockBehavior', () => {
  it('holds the lock while the handler runs and releases it afterwards', async () => {
    const lock = new InProcessResourceLock();
    const behavior = lockBehavior(lock);
    const r = await behavior(
      { lockKey: 'order:1' },
      nextOf(async () => {
        expect(lock.keyCount).toBe(1);
        expect(Maybe.isNone(await lock.tryAcquire('order:1'))).toBe(true);
        return Result.success(1);
      }),
      ctx(),
    );
    expect(r).toEqual(Result.success(1));
    expect(lock.keyCount).toBe(0);
  });

  it('passes the request timeout and the signal', async () => {
    const release = vi.fn();
    const acquire = vi.fn(async (): Promise<LockHandle> => ({ release }));
    const fake: ResourceLock = { acquire, tryAcquire: async () => Maybe.none() };
    const controller = new AbortController();
    await lockBehavior(fake)(
      { lockKey: 'k', lockTimeoutMs: 250 },
      nextOf(() => Result.ok()),
      ctx(controller.signal),
    );
    expect(acquire).toHaveBeenCalledWith('k', 250, controller.signal);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when the handler throws', async () => {
    const lock = new InProcessResourceLock();
    await expect(
      lockBehavior(lock)(
        { lockKey: 'k' },
        nextOf(() => {
          throw new Error('boom');
        }),
        ctx(),
      ),
    ).rejects.toThrow('boom');
    expect(lock.keyCount).toBe(0);
  });

  it('a throwing release does not mask the handler result and is logged', async () => {
    const logger = memoryLogger();
    const releaseError = new Error('release failed');
    const fake: ResourceLock = {
      acquire: async () => ({
        release: () => {
          throw releaseError;
        },
      }),
      tryAcquire: async () => Maybe.none(),
    };
    const r = await lockBehavior(fake, { logger })(
      { lockKey: 'k' },
      nextOf(() => Result.success(7)),
      ctx(),
    );
    expect(r).toEqual(Result.success(7));
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.level).toBe('warning');
    expect(logger.entries[0]?.message).toBe("Releasing the lock 'k' failed");
    expect(logger.entries[0]?.props).toMatchObject({ LockKey: 'k', Exception: releaseError });
  });

  it('a rejecting release keeps the handler error and works without a logger', async () => {
    const fake: ResourceLock = {
      acquire: async () => ({ release: () => Promise.reject(new Error('release failed')) }),
      tryAcquire: async () => Maybe.none(),
    };
    await expect(
      lockBehavior(fake)(
        { lockKey: 'k' },
        nextOf(() => {
          throw new Error('handler boom');
        }),
        ctx(),
      ),
    ).rejects.toThrow('handler boom');
    await expect(
      lockBehavior(fake)(
        { lockKey: 'k' },
        nextOf(() => Result.ok()),
        ctx(),
      ),
    ).resolves.toEqual(Result.ok());
  });

  it('a throwing release AND a throwing logger keep the handler result or error', async () => {
    const fake: ResourceLock = {
      acquire: async () => ({
        release: () => {
          throw new Error('release failed');
        },
      }),
      tryAcquire: async () => Maybe.none(),
    };
    const logger = {
      log: () => {
        throw new Error('logger down');
      },
    };
    await expect(
      lockBehavior(fake, { logger })(
        { lockKey: 'k' },
        nextOf(() => Result.success(7)),
        ctx(),
      ),
    ).resolves.toEqual(Result.success(7));
    await expect(
      lockBehavior(fake, { logger })(
        { lockKey: 'k' },
        nextOf(() => {
          throw new Error('handler boom');
        }),
        ctx(),
      ),
    ).rejects.toThrow('handler boom');
  });

  it('does not run the handler when the lock times out', async () => {
    const lock = new InProcessResourceLock();
    const held = await lock.acquire('k');
    const handler = vi.fn(() => Result.ok());
    await expect(
      lockBehavior(lock)({ lockKey: 'k', lockTimeoutMs: 10 }, nextOf(handler), ctx()),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    expect(handler).not.toHaveBeenCalled();
    await held.release();
  });

  it('times out into a failure behind the exception behavior', async () => {
    const lock = new InProcessResourceLock();
    const held = await lock.acquire('k');
    const locked = lockBehavior(lock);
    const request = { lockKey: 'k', lockTimeoutMs: 0 };
    const r = await exceptionHandlingBehavior()(
      request,
      async () =>
        locked(
          request,
          nextOf(() => Result.ok()),
          ctx(),
        ),
      ctx(),
    );
    expect(r.ok || r.errors[0]?.code).toBe('LockTimeoutError');
    await held.release();
  });

  it('serializes requests with the same key', async () => {
    const lock = new InProcessResourceLock();
    const behavior = lockBehavior(lock);
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      [1, 2, 3].map((n) =>
        behavior(
          { lockKey: 'k' },
          nextOf(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            return Result.success(n);
          }),
          ctx(),
        ),
      ),
    );
    expect(maxActive).toBe(1);
  });

  it('passes primitive and null requests through without locking', async () => {
    const acquire = vi.fn();
    const fake: ResourceLock = { acquire, tryAcquire: async () => Maybe.none() };
    for (const request of [null, 'key', 7]) {
      await lockBehavior(fake)(
        request,
        nextOf(() => Result.ok()),
        ctx(),
      );
    }
    expect(acquire).not.toHaveBeenCalled();
  });

  it('passes requests without a lock key through', async () => {
    const acquire = vi.fn();
    const fake: ResourceLock = { acquire, tryAcquire: async () => Maybe.none() };
    await lockBehavior(fake)(
      {},
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe('transactionBehavior', () => {
  function fakeRunner() {
    const outcomes: string[] = [];
    let innerSignal: AbortSignal | undefined;
    const runner: TransactionRunner = {
      async execute(work, shouldCommit, signal) {
        innerSignal = signal;
        try {
          const result = await work(signal);
          outcomes.push(shouldCommit(result) ? 'commit' : 'rollback');
          return result;
        } catch (error) {
          outcomes.push('rollback');
          throw error;
        }
      },
    };
    return { runner, outcomes, signal: () => innerSignal };
  }

  const tx = { transactional: true };

  it('commits when the result succeeds', async () => {
    const f = fakeRunner();
    await transactionBehavior(f.runner)(
      tx,
      nextOf(() => Result.success(1)),
      ctx(),
    );
    expect(f.outcomes).toEqual(['commit']);
  });

  it('rolls back when the result fails', async () => {
    const f = fakeRunner();
    await transactionBehavior(f.runner)(
      tx,
      nextOf(() => Result.failure(Err.conflict('C', 'c'))),
      ctx(),
    );
    expect(f.outcomes).toEqual(['rollback']);
  });

  it('rolls back and rethrows when the handler throws', async () => {
    const f = fakeRunner();
    await expect(
      transactionBehavior(f.runner)(
        tx,
        nextOf(() => {
          throw new Error('boom');
        }),
        ctx(),
      ),
    ).rejects.toThrow('boom');
    expect(f.outcomes).toEqual(['rollback']);
  });

  it('passes the signal to the runner and skips non-transactional requests', async () => {
    const f = fakeRunner();
    const controller = new AbortController();
    await transactionBehavior(f.runner)(
      tx,
      nextOf(() => Result.ok()),
      ctx(controller.signal),
    );
    expect(f.signal()).toBe(controller.signal);
    await transactionBehavior(f.runner)(
      {},
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(f.outcomes).toEqual(['commit']);
  });

  it('honours a custom predicate', async () => {
    const f = fakeRunner();
    await transactionBehavior(f.runner, { isTransactional: (r) => r === 'tx' })(
      'tx',
      nextOf(() => Result.ok()),
      ctx(),
    );
    expect(f.outcomes).toEqual(['commit']);
  });
});
