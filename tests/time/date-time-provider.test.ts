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
    expect(date.getUTCMilliseconds()).toBe(0);
  });

  it('returns ms timestamp', () => {
    const ts = SystemDateTimeProvider.utcNowMs();
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(0);
  });

  it('utcNowDate returns a date object (not same reference as utcNow)', () => {
    const now = SystemDateTimeProvider.utcNow();
    const date = SystemDateTimeProvider.utcNowDate();
    expect(date).not.toBe(now);
    expect(date.getTime()).toBeLessThanOrEqual(now.getTime());
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

  it('allows negative advance', () => {
    const fake = createFakeDateTimeProvider(fixedDate);
    fake.advance(-1000);
    expect(fake.utcNow().getTime()).toBe(fixedDate.getTime() - 1000);
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

  it('utcNowDate returns date with zeroed time', () => {
    const fake = createFakeDateTimeProvider(new Date('2024-06-15T14:30:45.123Z'));
    const date = fake.utcNowDate();
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth()).toBe(5); // June = 5
    expect(date.getUTCDate()).toBe(15);
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
    expect(date.getUTCMilliseconds()).toBe(0);
  });

  it('utcNowDate returns independent copy', () => {
    const fake = createFakeDateTimeProvider(fixedDate);
    const d1 = fake.utcNowDate();
    const d2 = fake.utcNowDate();
    expect(d1).not.toBe(d2);
    expect(d1).toEqual(d2);
  });
});
