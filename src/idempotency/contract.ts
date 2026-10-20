import { createFakeDateTimeProvider, type DateTimeProvider } from '../time/index.js';
import type { IdempotencyRecordKey, IdempotencyReservation, IdempotencyStore } from './store.js';

/** The test functions of any runner with a `describe`/`it` API (vitest, jest, mocha, node:test). */
export interface ContractTestApi {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => Promise<void>): void;
}

/** A fake clock the store under test can read; the suite moves it forward. */
export type ContractClock = DateTimeProvider & { advance(ms: number): void };

/** Options of {@link describeIdempotencyStoreContract}. */
export interface IdempotencyStoreContractOptions {
  /** Lease used by the scenarios. Default: 1 000. */
  readonly leaseMs?: number | undefined;
  /** Retention used by the scenarios. Default: 10 000. */
  readonly retentionMs?: number | undefined;
  /**
   * Lets time pass. Default: moves the fake clock. A store that measures time itself (Redis
   * `PX`) passes a real wait here, together with short `leaseMs` and `retentionMs`.
   */
  readonly advance?: ((ms: number, clock: ContractClock) => void | Promise<void>) | undefined;
  /** Parallel `reserve` calls of the concurrency scenario. Default: 20. */
  readonly parallelism?: number | undefined;
}

class ContractAssertionError extends Error {
  override readonly name = 'ContractAssertionError';
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ContractAssertionError(message);
}

function checkStatus(
  actual: IdempotencyReservation,
  expected: IdempotencyReservation['status'],
  step: string,
): void {
  check(
    actual.status === expected,
    `${step}: expected reservation '${expected}', got '${actual.status}'`,
  );
}

async function checkRejects(promise: () => Promise<unknown>, step: string): Promise<void> {
  let rejected = false;
  try {
    await promise();
  } catch {
    rejected = true;
  }
  check(rejected, `${step}: expected the call to reject`);
}

function tokenOf(reservation: IdempotencyReservation, step: string): string {
  check(
    reservation.status === 'reserved',
    `${step}: expected 'reserved', got '${reservation.status}'`,
  );
  check(
    typeof reservation.token === 'string' && reservation.token.length > 0,
    `${step}: expected a non-empty token`,
  );
  return reservation.token;
}

/**
 * Registers the scenarios every {@link IdempotencyStore} must pass: reserve, complete and
 * release with token fencing, lease and retention expiry, fingerprint mismatch, isolation by
 * namespace, scope and key, a single winner among parallel reserves, and argument checks.
 * Runner-agnostic: pass your runner's `describe` and `it`.
 *
 * ```ts
 * import { describe, it } from 'vitest';
 * describeIdempotencyStoreContract('MyStore', (clock) => new MyStore({ clock }), { describe, it });
 * ```
 *
 * The factory gets a fresh fake clock per scenario; stores that take a clock should use it.
 */
export function describeIdempotencyStoreContract(
  name: string,
  factory: (clock: ContractClock) => IdempotencyStore | Promise<IdempotencyStore>,
  api: ContractTestApi,
  options: IdempotencyStoreContractOptions = {},
): void {
  const lease = options.leaseMs ?? 1_000;
  const retention = options.retentionMs ?? 10_000;
  const parallelism = options.parallelism ?? 20;
  let counter = 0;

  const scenario = (title: string, body: (ctx: Scenario) => Promise<void>) =>
    api.it(title, async () => {
      const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
      const store = await factory(clock);
      const advance = async (ms: number) => {
        await (options.advance ? options.advance(ms, clock) : clock.advance(ms));
      };
      // Unique keys per scenario, so a store shared across scenarios (a real Redis) still works.
      counter += 1;
      const run = `${Date.now().toString(36)}-${counter}`;
      const key = (suffix = 'k'): IdempotencyRecordKey => ({
        namespace: `contract-${run}`,
        scope: 'tenant:1',
        key: suffix,
      });
      await body({ store, advance, key });
    });

  api.describe(`${name} (idempotency store contract)`, () => {
    scenario('reserves a new key with a non-empty token', async ({ store, key }) => {
      tokenOf(await store.reserve(key(), 'fp', lease), 'first reserve');
    });

    scenario('reports a reserved key as in flight', async ({ store, key }) => {
      await store.reserve(key(), 'fp', lease);
      checkStatus(await store.reserve(key(), 'fp', lease), 'inFlight', 'second reserve');
    });

    scenario(
      'reports another fingerprint as a mismatch while in flight',
      async ({ store, key }) => {
        await store.reserve(key(), 'fp', lease);
        checkStatus(await store.reserve(key(), 'other', lease), 'mismatch', 'other fingerprint');
      },
    );

    scenario('replays the payload after complete', async ({ store, key }) => {
      const token = tokenOf(await store.reserve(key(), 'fp', lease), 'reserve');
      check(await store.complete(key(), token, 'fp', 'payload-1', retention), 'complete');
      const replay = await store.reserve(key(), 'fp', lease);
      checkStatus(replay, 'completed', 'reserve after complete');
      check(
        replay.status === 'completed' && replay.payload === 'payload-1',
        'reserve after complete: expected the stored payload',
      );
      checkStatus(await store.reserve(key(), 'other', lease), 'mismatch', 'other fingerprint');
    });

    scenario('refuses complete with another token', async ({ store, key }) => {
      await store.reserve(key(), 'fp', lease);
      check(
        !(await store.complete(key(), 'not-the-token', 'fp', 'p', retention)),
        'complete with another token returned true',
      );
      checkStatus(await store.reserve(key(), 'fp', lease), 'inFlight', 'after refused complete');
    });

    scenario('refuses a second complete', async ({ store, key }) => {
      const token = tokenOf(await store.reserve(key(), 'fp', lease), 'reserve');
      check(await store.complete(key(), token, 'fp', 'first', retention), 'first complete');
      check(
        !(await store.complete(key(), token, 'fp', 'second', retention)),
        'second complete returned true',
      );
      const replay = await store.reserve(key(), 'fp', lease);
      check(
        replay.status === 'completed' && replay.payload === 'first',
        'second complete changed the stored payload',
      );
    });

    scenario('release frees the key for a new reservation', async ({ store, key }) => {
      const token = tokenOf(await store.reserve(key(), 'fp', lease), 'reserve');
      check(await store.release(key(), token), 'release');
      const again = tokenOf(await store.reserve(key(), 'other', lease), 'reserve after release');
      check(again !== token, 'reserve after release reused the old token');
    });

    scenario('refuses release with another token', async ({ store, key }) => {
      await store.reserve(key(), 'fp', lease);
      check(!(await store.release(key(), 'not-the-token')), 'release with another token');
      checkStatus(await store.reserve(key(), 'fp', lease), 'inFlight', 'after refused release');
    });

    scenario('never releases a completed record', async ({ store, key }) => {
      const token = tokenOf(await store.reserve(key(), 'fp', lease), 'reserve');
      await store.complete(key(), token, 'fp', 'p', retention);
      check(!(await store.release(key(), token)), 'release after complete returned true');
      checkStatus(await store.reserve(key(), 'fp', lease), 'completed', 'after refused release');
    });

    scenario('release of an unknown key returns false', async ({ store, key }) => {
      check(!(await store.release(key('missing'), 'token')), 'release of an unknown key');
    });

    scenario('an expired lease can be taken over, fencing the old token', async (ctx) => {
      const { store, key, advance } = ctx;
      const first = tokenOf(await store.reserve(key(), 'fp', lease), 'first reserve');
      await advance(lease + 1);
      const second = tokenOf(await store.reserve(key(), 'other', lease), 'take over');
      check(second !== first, 'take over reused the old token');
      check(!(await store.complete(key(), first, 'fp', 'stale', retention)), 'stale complete');
      check(!(await store.release(key(), first)), 'stale release');
      check(await store.complete(key(), second, 'other', 'fresh', retention), 'new complete');
    });

    scenario('an expired lease nobody took over can still be completed', async (ctx) => {
      const { store, key, advance } = ctx;
      const token = tokenOf(await store.reserve(key(), 'fp', lease), 'reserve');
      await advance(lease + 1);
      check(await store.complete(key(), token, 'fp', 'late', retention), 'late complete');
      checkStatus(await store.reserve(key(), 'fp', lease), 'completed', 'after late complete');
    });

    scenario('a completed record expires after its retention', async (ctx) => {
      const { store, key, advance } = ctx;
      const token = tokenOf(await store.reserve(key(), 'fp', lease), 'reserve');
      await store.complete(key(), token, 'fp', 'p', retention);
      await advance(retention + 1);
      tokenOf(await store.reserve(key(), 'other', lease), 'reserve after retention');
    });

    scenario('isolates namespaces, scopes and keys', async ({ store, key }) => {
      const base = key();
      await store.reserve(base, 'fp', lease);
      tokenOf(
        await store.reserve({ ...base, namespace: `${base.namespace}-other` }, 'fp', lease),
        'other namespace',
      );
      tokenOf(await store.reserve({ ...base, scope: 'tenant:2' }, 'fp', lease), 'other scope');
      tokenOf(await store.reserve({ ...base, key: 'other-key' }, 'fp', lease), 'other key');
    });

    scenario('keeps parts that contain separators apart', async ({ store, key }) => {
      const base = key();
      await store.reserve({ ...base, scope: 'a|1:b', key: 'c' }, 'fp', lease);
      tokenOf(
        await store.reserve({ ...base, scope: 'a', key: 'b|1:c' }, 'fp', lease),
        'shifted separator',
      );
    });

    scenario('keeps parts that differ only by trailing spaces apart', async ({ store, key }) => {
      const base = key();
      await store.reserve({ ...base, scope: 'tenant:a', key: 'k' }, 'fp', lease);
      tokenOf(
        await store.reserve({ ...base, scope: 'tenant:a ', key: 'k' }, 'fp', lease),
        'scope with a trailing space',
      );
      tokenOf(
        await store.reserve({ ...base, scope: 'tenant:a', key: 'k ' }, 'fp', lease),
        'key with a trailing space',
      );
    });

    scenario('gives one winner among parallel reserves', async ({ store, key }) => {
      const results = await Promise.all(
        Array.from({ length: parallelism }, () => store.reserve(key(), 'fp', lease)),
      );
      const winners = results.filter((r) => r.status === 'reserved').length;
      check(winners === 1, `parallel reserves: expected 1 winner, got ${winners}`);
      check(
        results.every((r) => r.status === 'reserved' || r.status === 'inFlight'),
        'parallel reserves: losers must see inFlight',
      );
    });

    scenario('rejects an aborted reserve', async ({ store, key }) => {
      const controller = new AbortController();
      controller.abort();
      await checkRejects(
        () => store.reserve(key(), 'fp', lease, controller.signal),
        'aborted reserve',
      );
    });

    scenario('rejects invalid arguments', async ({ store, key }) => {
      await checkRejects(() => store.reserve(key(), 'fp', 0), 'reserve with leaseMs 0');
      await checkRejects(() => store.reserve(key(), '', lease), 'reserve with empty fingerprint');
      const token = tokenOf(await store.reserve(key(), 'fp', lease), 'reserve');
      await checkRejects(
        () => store.complete(key(), token, 'fp', 'p', 0),
        'complete with retentionMs 0',
      );
      await checkRejects(() => store.complete(key(), '', 'fp', 'p', retention), 'empty token');
      await checkRejects(() => store.complete(key(), token, '', 'p', retention), 'empty fp');
      await checkRejects(() => store.release(key(), ''), 'release with empty token');
    });
  });
}

interface Scenario {
  readonly store: IdempotencyStore;
  readonly advance: (ms: number) => Promise<void>;
  readonly key: (suffix?: string) => IdempotencyRecordKey;
}
