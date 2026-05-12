import { SystemDateTimeProvider, createFakeDateTimeProvider } from '../../src/time/date-time-provider.js';

describe('SystemDateTimeProvider', () => {
  it('returns a current date', () => {
    const before = Date.now();
    const now = SystemDateTimeProvider.utcNow();
    const after = Date.now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns UTC date with zeroed time', () => {
    const date = SystemDateTimeProvider.utcNowDate();
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
  });

  it('returns ms timestamp', () => {
    const ts = SystemDateTimeProvider.utcNowMs();
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(0);
  });
});

describe('createFakeDateTimeProvider', () => {
  const fixedDate = new Date('2024-01-15T10:30:00.000Z');

  it('returns the fixed time', () => {
    const fake = createFakeDateTimeProvider(fixedDate);
    expect(fake.utcNow()).toEqual(fixedDate);
  });

  it('advances time by milliseconds', () => {
    const fake = createFakeDateTimeProvider(fixedDate);
    fake.advance(5000);
    expect(fake.utcNow().getTime()).toBe(fixedDate.getTime() + 5000);
  });

  it('allows setting time explicitly', () => {
    const fake = createFakeDateTimeProvider(fixedDate);
    const newDate = new Date('2025-06-01T00:00:00.000Z');
    fake.setTime(newDate);
    expect(fake.utcNow()).toEqual(newDate);
  });

  it('returns independent copies (not same reference)', () => {
    const fake = createFakeDateTimeProvider(fixedDate);
    const t1 = fake.utcNow();
    const t2 = fake.utcNow();
    expect(t1).not.toBe(t2); // different object references
    expect(t1).toEqual(t2);  // same value
  });

  it('utcNowMs returns correct milliseconds', () => {
    const fake = createFakeDateTimeProvider(fixedDate);
    expect(fake.utcNowMs()).toBe(fixedDate.getTime());
  });
});
