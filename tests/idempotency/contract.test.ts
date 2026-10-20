import {
  type ContractClock,
  describeIdempotencyStoreContract,
  type IdempotencyReservation,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
} from '../../src/idempotency/index.js';

interface Case {
  name: string;
  body: () => Promise<void>;
}

function collect(factory: (clock: ContractClock) => IdempotencyStore): Case[] {
  const cases: Case[] = [];
  describeIdempotencyStoreContract('Broken', factory, {
    describe: (_name, body) => body(),
    it: (name, body) => cases.push({ name, body }),
  });
  return cases;
}

async function failures(
  factory: (clock: ContractClock) => IdempotencyStore,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of collect(factory)) {
    try {
      await c.body();
    } catch (error) {
      expect((error as Error).name).toBe('ContractAssertionError');
      out[c.name] = (error as Error).message;
    }
  }
  return out;
}

const reserved = (token: string): IdempotencyReservation => ({ status: 'reserved', token });

describe('describeIdempotencyStoreContract', () => {
  it('registers every scenario under one describe', () => {
    const names: string[] = [];
    describeIdempotencyStoreContract('X', () => new InMemoryIdempotencyStore(), {
      describe: (name, body) => {
        names.push(name);
        body();
      },
      it: () => undefined,
    });
    expect(names).toEqual(['X (idempotency store contract)']);
    expect(collect(() => new InMemoryIdempotencyStore()).length).toBe(26);
  });

  it('fails a store whose keys ignore trailing spaces, like a PAD SPACE collation', async () => {
    const padded = (trimScope: boolean) =>
      failures((clock) => {
        const inner = new InMemoryIdempotencyStore({ clock });
        const pad = <K extends { scope: string; key: string }>(k: K): K => ({
          ...k,
          scope: trimScope ? k.scope.trimEnd() : k.scope,
          key: k.key.trimEnd(),
        });
        return {
          reserve: (k, ...rest) => inner.reserve(pad(k), ...rest),
          complete: (k, ...rest) => inner.complete(pad(k), ...rest),
          release: (k, ...rest) => inner.release(pad(k), ...rest),
        };
      });
    const name = 'keeps parts that differ only by trailing spaces apart';
    const both = await padded(true);
    expect(Object.keys(both)).toEqual([name]);
    expect(both[name]).toContain('scope with a trailing space');
    const keyOnly = await padded(false);
    expect(Object.keys(keyOnly)).toEqual([name]);
    expect(keyOnly[name]).toContain('key with a trailing space');
  });

  it('fails every scenario of a store that always reserves with the same token', async () => {
    const store: IdempotencyStore = {
      reserve: async () => reserved('same'),
      complete: async () => true,
      release: async () => true,
    };
    const result = await failures(() => store);
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(14);
    expect(result['reports a reserved key as in flight']).toContain("got 'reserved'");
    expect(result['rejects an aborted reserve']).toContain('expected the call to reject');
    expect(result['release of an unknown key returns false']).toBeDefined();
    expect(result['reserves a new key with a non-empty token']).toBeUndefined();
    expect(result['never revives an expired lease']).toBeUndefined();
  });

  it('fails a store that returns empty tokens or non-reserved results', async () => {
    const empty = await failures(() => ({
      reserve: async () => reserved(''),
      complete: async () => false,
      release: async () => false,
    }));
    expect(empty['reserves a new key with a non-empty token']).toContain('non-empty token');
    const busy = await failures(() => ({
      reserve: async () => ({ status: 'inFlight' }),
      complete: async () => false,
      release: async () => false,
    }));
    expect(busy['reserves a new key with a non-empty token']).toContain("got 'inFlight'");
  });

  it('fails a store that replays a wrong payload or lets many reserves win', async () => {
    let n = 0;
    const result = await failures(() => {
      const inner = new InMemoryIdempotencyStore();
      return {
        reserve: async (key, fp, lease, signal) => {
          const r = await inner.reserve(key, fp, lease, signal);
          if (r.status === 'completed') return { status: 'completed', payload: 'wrong' };
          if (r.status === 'inFlight') return reserved(`t${++n}`);
          return r;
        },
        complete: (...args) => inner.complete(...args),
        release: (...args) => inner.release(...args),
        extend: async () => false,
      };
    });
    expect(result['never extends a completed record']).toContain('changed the completed record');
    expect(result['replays the payload after complete']).toContain('stored payload');
    expect(result['refuses a second complete']).toContain('changed the stored payload');
    expect(result['gives one winner among parallel reserves']).toContain('expected 1 winner');
  });

  it('fails a store whose parallel losers see something other than inFlight', async () => {
    const result = await failures(() => {
      const inner = new InMemoryIdempotencyStore();
      return {
        reserve: async (key, fp, lease, signal) => {
          const r = await inner.reserve(key, fp, lease, signal);
          return r.status === 'inFlight' ? { status: 'mismatch' } : r;
        },
        complete: (...args) => inner.complete(...args),
        release: (...args) => inner.release(...args),
      };
    });
    expect(result['gives one winner among parallel reserves']).toContain(
      'losers must see inFlight',
    );
  });

  it('fails a store that reuses a released token', async () => {
    const result = await failures(
      (clock) => new InMemoryIdempotencyStore({ clock, tokenFactory: () => 'constant' }),
    );
    expect(result['release frees the key for a new reservation']).toContain('reused the old token');
    expect(result['an expired lease can be taken over, fencing the old token']).toContain(
      'reused the old token',
    );
  });

  it('fails a store whose extend always returns true', async () => {
    const result = await failures((clock) => {
      const inner = new InMemoryIdempotencyStore({ clock });
      return {
        reserve: (...args) => inner.reserve(...args),
        complete: (...args) => inner.complete(...args),
        release: (...args) => inner.release(...args),
        extend: async () => true,
      };
    });
    expect(result['extend keeps a reservation in flight past its lease']).toContain(
      "after extend: expected reservation 'inFlight', got 'reserved'",
    );
    expect(result['refuses extend with another token']).toContain('extend with another token');
    expect(result['fences the old token after a take over']).toContain('stale extend');
    expect(result['extend of an unknown key returns false']).toContain('unknown key');
    expect(result['never extends a completed record']).toContain('extend after complete');
    expect(result['never revives an expired lease']).toContain('expired lease');
    expect(result['rejects invalid extend arguments and an aborted extend']).toContain(
      'extend with empty token',
    );
  });

  it('fails a store whose extend ignores the token and reports false', async () => {
    const result = await failures((clock) => {
      const inner = new InMemoryIdempotencyStore({ clock });
      let last = 'none';
      return {
        reserve: async (...args) => {
          const r = await inner.reserve(...args);
          if (r.status === 'reserved') last = r.token;
          return r;
        },
        complete: (...args) => inner.complete(...args),
        release: (...args) => inner.release(...args),
        extend: async (key, _token, leaseMs) => {
          await inner.extend(key, last, leaseMs);
          return false;
        },
      };
    });
    expect(result['extend keeps a reservation in flight past its lease']).toContain(
      'extend with the right token returned false',
    );
    expect(result['refuses extend with another token']).toContain(
      "reserve after refused extend: expected 'reserved', got 'inFlight'",
    );
    expect(result['fences the old token after a take over']).toContain(
      'extend of the new reservation returned false',
    );
  });

  it('passes the in-memory store', async () => {
    expect(await failures((clock) => new InMemoryIdempotencyStore({ clock }))).toEqual({});
  });

  it('accepts an async factory', async () => {
    const cases: Case[] = [];
    describeIdempotencyStoreContract(
      'Async',
      async (clock) => new InMemoryIdempotencyStore({ clock }),
      {
        describe: (_name, body) => body(),
        it: (name, body) => cases.push({ name, body }),
      },
    );
    for (const c of cases) await c.body();
  });

  describe('a store without extend', () => {
    const withoutExtend = (clock: ContractClock): IdempotencyStore => {
      const inner = new InMemoryIdempotencyStore({ clock });
      return {
        reserve: (...a) => inner.reserve(...a),
        complete: (...a) => inner.complete(...a),
        release: (...a) => inner.release(...a),
      };
    };
    type Body = (this: unknown, ...args: unknown[]) => Promise<void>;
    const register = () => {
      const cases: { name: string; body: Body }[] = [];
      describeIdempotencyStoreContract('NoExtend', withoutExtend, {
        describe: (_name, body) => body(),
        it: (name, body) => cases.push({ name, body }),
      });
      return cases;
    };
    it('skips the extend scenarios through the context argument (vitest, node:test)', async () => {
      const skipped: string[] = [];
      for (const c of register()) {
        await c.body.call(undefined, { skip: () => skipped.push(c.name) });
      }
      expect(skipped).toHaveLength(7);
      expect(skipped).toContain('never revives an expired lease');
      expect(skipped).not.toContain('reserves a new key with a non-empty token');
    });

    it('skips them through this (mocha) and stops when skip throws', async () => {
      const pending = new Error('pending');
      const skipped: string[] = [];
      for (const c of register()) {
        const context = {
          skip() {
            skipped.push(c.name);
            throw pending;
          },
        };
        const outcome = await c.body.call(context).then(
          () => 'passed',
          (error: unknown) => error,
        );
        expect(outcome).toBe(skipped.includes(c.name) ? pending : 'passed');
      }
      expect(skipped).toHaveLength(7);
    });

    it('passes them on a runner without skip', async () => {
      for (const c of register()) await c.body.call(undefined);
      for (const c of register()) await c.body.call({});
    });

    it('never calls skip for a store with extend', async () => {
      const cases: { name: string; body: Body }[] = [];
      describeIdempotencyStoreContract(
        'WithExtend',
        (clock) => new InMemoryIdempotencyStore({ clock }),
        { describe: (_name, body) => body(), it: (name, body) => cases.push({ name, body }) },
      );
      const skip = vi.fn();
      for (const c of cases) await c.body.call({ skip }, { skip });
      expect(skip).not.toHaveBeenCalled();
    });
  });
});

// With fixtures registered, vitest parses each test function's parameter list; the scenarios
// must still run there, and the extend scenarios must still skip through the context.
const withFixture = test.extend<{ label: string }>({
  label: async ({ task }, use) => {
    await use(task.name);
  },
});

describeIdempotencyStoreContract(
  'InMemoryIdempotencyStore with vitest fixtures',
  (clock) => new InMemoryIdempotencyStore({ clock }),
  { describe, it: withFixture },
);

describeIdempotencyStoreContract(
  'A store without extend with vitest fixtures',
  (clock) => {
    const inner = new InMemoryIdempotencyStore({ clock });
    return {
      reserve: (...a) => inner.reserve(...a),
      complete: (...a) => inner.complete(...a),
      release: (...a) => inner.release(...a),
    };
  },
  { describe, it: withFixture },
);
