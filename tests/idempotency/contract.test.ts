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
    expect(collect(() => new InMemoryIdempotencyStore()).length).toBe(19);
  });

  it('fails a store whose keys ignore trailing spaces, like a PAD SPACE collation', async () => {
    const result = await failures((clock) => {
      const inner = new InMemoryIdempotencyStore({ clock });
      const pad = <K extends { scope: string; key: string }>(k: K): K => ({
        ...k,
        scope: k.scope.trimEnd(),
        key: k.key.trimEnd(),
      });
      return {
        reserve: (k, ...rest) => inner.reserve(pad(k), ...rest),
        complete: (k, ...rest) => inner.complete(pad(k), ...rest),
        release: (k, ...rest) => inner.release(pad(k), ...rest),
      };
    });
    expect(Object.keys(result)).toEqual(['keeps parts that differ only by trailing spaces apart']);
    expect(Object.values(result)[0]).toContain('scope with a trailing space');
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
      };
    });
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
});
