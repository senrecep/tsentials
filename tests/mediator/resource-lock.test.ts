import { Maybe } from '../../src/maybe/maybe.js';
import {
  formatDuration,
  InProcessResourceLock,
  type LockHandle,
  LockTimeoutError,
} from '../../src/mediator/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('InProcessResourceLock', () => {
  it('waits for the holder of the same key', async () => {
    const lock = new InProcessResourceLock();
    const first = await lock.acquire('k');
    let acquired = false;
    const second = lock.acquire('k').then((h) => {
      acquired = true;
      return h;
    });
    await tick();
    expect(acquired).toBe(false);
    await first.release();
    const handle = await second;
    expect(acquired).toBe(true);
    await handle.release();
    expect(lock.keyCount).toBe(0);
  });

  it('does not block different keys', async () => {
    const lock = new InProcessResourceLock();
    const a = await lock.acquire('a');
    const b = await lock.acquire('b', 0);
    expect(lock.keyCount).toBe(2);
    await a.release();
    await b.release();
    expect(lock.keyCount).toBe(0);
  });

  it('serializes concurrent work per key in FIFO order', async () => {
    const lock = new InProcessResourceLock();
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      [1, 2, 3, 4].map(async (n) => {
        const h = await lock.acquire('k');
        active++;
        maxActive = Math.max(maxActive, active);
        await tick();
        order.push(n);
        active--;
        await h.release();
      }),
    );
    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(lock.keyCount).toBe(0);
  });

  it('tryAcquire returns None while the key is held', async () => {
    const lock = new InProcessResourceLock();
    const held = await lock.acquire('k');
    expect(Maybe.isNone(await lock.tryAcquire('k'))).toBe(true);
    expect(lock.keyCount).toBe(1);
    await held.release();
    const free = await lock.tryAcquire('k');
    expect(Maybe.isSome(free)).toBe(true);
    if (Maybe.isSome(free)) await free.value.release();
    expect(lock.keyCount).toBe(0);
  });

  it('throws LockTimeoutError and releases the waiter entry', async () => {
    const lock = new InProcessResourceLock();
    const held = await lock.acquire('k');
    await expect(lock.acquire('k', 20)).rejects.toThrow(new LockTimeoutError('k', 20).message);
    await expect(lock.acquire('k', 0)).rejects.toBeInstanceOf(LockTimeoutError);
    expect(lock.keyCount).toBe(1);
    await held.release();
    expect(lock.keyCount).toBe(0);
  });

  it('formats the timeout as hh:mm:ss', () => {
    expect(new LockTimeoutError('k', 50).message).toBe(
      "The lock for 'k' was not acquired within 00:00:00.0500000.",
    );
    expect(new LockTimeoutError('k', 50).name).toBe('LockTimeoutError');
  });

  it('rejects with the abort reason and removes the waiter when aborted', async () => {
    const lock = new InProcessResourceLock();
    const held = await lock.acquire('k');
    const controller = new AbortController();
    const waiting = lock.acquire('k', undefined, controller.signal);
    controller.abort(new Error('stop'));
    await expect(waiting).rejects.toThrow('stop');
    expect(lock.keyCount).toBe(1);
    await held.release();
    expect(lock.keyCount).toBe(0);
    // The aborted waiter must not receive the lock.
    const again = await lock.acquire('k', 0);
    await again.release();
  });

  it('rejects immediately for an already aborted signal', async () => {
    const lock = new InProcessResourceLock();
    const controller = new AbortController();
    controller.abort();
    await expect(lock.acquire('k', undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(lock.tryAcquire('k', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(lock.keyCount).toBe(0);
  });

  it('release is idempotent and removes the key', async () => {
    const lock = new InProcessResourceLock();
    const h: LockHandle = await lock.acquire('k');
    await h.release();
    await h.release();
    expect(lock.keyCount).toBe(0);
    const other = await lock.acquire('k', 0);
    await h.release();
    expect(lock.keyCount).toBe(1);
    await other.release();
  });

  it('validates arguments', async () => {
    const lock = new InProcessResourceLock();
    await expect(lock.acquire('')).rejects.toBeInstanceOf(TypeError);
    await expect(lock.tryAcquire('')).rejects.toBeInstanceOf(TypeError);
    await expect(lock.acquire(42 as unknown as string)).rejects.toThrow(
      'The lock key must be a string.',
    );
    await expect(lock.acquire('k', -1)).rejects.toBeInstanceOf(RangeError);
    await expect(lock.acquire('k', Number.NaN)).rejects.toBeInstanceOf(RangeError);
    await expect(lock.acquire('k', 2 ** 31)).rejects.toBeInstanceOf(RangeError);
    expect(lock.keyCount).toBe(0);
  });

  it('accepts a zero timeout when the key is free', async () => {
    const lock = new InProcessResourceLock();
    const h = await lock.acquire('k', 0);
    await h.release();
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '00:00:00'],
    [1500, '00:00:01.5000000'],
    [0.0001, '00:00:00.0000001'],
    [61_000, '00:01:01'],
    [90_061_000, '1.01:01:01'],
    [-1000, '-00:00:01'],
  ])('%d ms -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
