import { monotonicUuidv7, uuidv7 } from '../../src/uuid/index.js';

const PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampOf = (id: string) => Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
const counterOf = (id: string) => {
  const hex = id.replace(/-/g, '');
  return (Number.parseInt(hex.slice(13, 16), 16) << 6) | (Number.parseInt(hex.slice(16, 18), 16) & 0x3f);
};

afterEach(() => {
  vi.restoreAllMocks();
});

// The monotonic generator keeps per-process state, so each of its tests gets a fresh module.
async function freshMonotonic() {
  vi.resetModules();
  return (await import('../../src/uuid/index.js')).monotonicUuidv7;
}

describe.each([
  ['uuidv7', uuidv7],
  ['monotonicUuidv7', monotonicUuidv7],
])('%s', (_, generate) => {
  it('sets the version 7 and RFC variant bits', () => {
    for (let i = 0; i < 100; i++) expect(generate()).toMatch(PATTERN);
  });

  it('encodes the current Unix millisecond timestamp', () => {
    const ms = 0xfedcba987654; // 48 bits, so the high bytes need more than 32-bit arithmetic
    vi.spyOn(Date, 'now').mockReturnValue(ms);
    expect(timestampOf(generate())).toBe(ms);
  });
});

describe('uuidv7', () => {
  it('returns distinct ids within one millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    expect(new Set(Array.from({ length: 1000 }, uuidv7)).size).toBe(1000);
  });
});

describe('monotonicUuidv7', () => {
  it('orders 10k ids generated within one millisecond', async () => {
    const monotonicUuidv7 = await freshMonotonic();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const ids = Array.from({ length: 10_000 }, monotonicUuidv7);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every((id) => timestampOf(id) === 1_800_000_000_000)).toBe(true);
    expect(counterOf(ids[0] as string)).toBe(0);
    expect(counterOf(ids[9_999] as string)).toBe(9_999);
  });

  it('restarts the counter at zero on a new millisecond', async () => {
    const monotonicUuidv7 = await freshMonotonic();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000);
    monotonicUuidv7();
    monotonicUuidv7();
    now.mockReturnValue(1_900_000_000_001);
    const id = monotonicUuidv7();
    expect(timestampOf(id)).toBe(1_900_000_000_001);
    expect(counterOf(id)).toBe(0);
  });

  it('stays ordered when the clock goes back', async () => {
    const monotonicUuidv7 = await freshMonotonic();
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    const first = monotonicUuidv7();
    now.mockReturnValue(1_999_999_999_000);
    const second = monotonicUuidv7();
    expect(second > first).toBe(true);
    expect(timestampOf(second)).toBe(2_000_000_000_000);
  });

  it('carries counter overflow into the timestamp', async () => {
    const monotonicUuidv7 = await freshMonotonic();
    vi.spyOn(Date, 'now').mockReturnValue(2_100_000_000_000);
    let previous = monotonicUuidv7();
    for (let i = 0; i < 0x3ffff; i++) previous = monotonicUuidv7();
    expect(counterOf(previous)).toBe(0x3ffff);
    const next = monotonicUuidv7();
    expect(next > previous).toBe(true);
    expect(timestampOf(next)).toBe(2_100_000_000_001);
    expect(counterOf(next)).toBe(0);
  });
});
