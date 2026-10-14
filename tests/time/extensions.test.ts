import { Maybe } from '../../src/maybe/maybe.js';
import {
  createFakeDateTimeProvider,
  type DateTimeProvider,
  SystemDateTimeProvider,
} from '../../src/time/date-time-provider.js';
import {
  DayOfWeek,
  getAge,
  msToDate,
  nextDayOfWeek,
  previousDayOfWeek,
  toDateOnly,
  toTimeOnly,
} from '../../src/time/extensions.js';

const d = (y: number, m: number, day: number, h = 0, min = 0, s = 0, ms = 0): Date =>
  new Date(Date.UTC(y, m - 1, day, h, min, s, ms));

describe('toDateOnly / toTimeOnly', () => {
  it('extracts the UTC date at midnight', () => {
    expect(toDateOnly(d(2024, 6, 15, 14, 30, 45))).toEqual(d(2024, 6, 15));
  });

  it('extracts the UTC time of day', () => {
    expect(toTimeOnly(d(2024, 6, 15, 14, 30, 45, 123))).toEqual({
      hour: 14,
      minute: 30,
      second: 45,
      millisecond: 123,
    });
    expect(toTimeOnly(d(2024, 1, 1))).toEqual({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  });

  it('date and time recombine to the original value', () => {
    const value = d(2024, 12, 25, 8, 15, 30);
    const t = toTimeOnly(value);
    const date = toDateOnly(value);
    expect(date.getTime() + ((t.hour * 60 + t.minute) * 60 + t.second) * 1000 + t.millisecond).toBe(
      value.getTime(),
    );
  });
});

describe('nextDayOfWeek', () => {
  const saturday = d(2024, 6, 15);
  it.each([
    [DayOfWeek.Monday, false, d(2024, 6, 17)],
    [DayOfWeek.Saturday, false, d(2024, 6, 22)],
    [DayOfWeek.Saturday, true, d(2024, 6, 15)],
    [DayOfWeek.Sunday, false, d(2024, 6, 16)],
  ] as const)('day %i includeCurrent=%s', (day, includeCurrent, expected) => {
    expect(nextDayOfWeek(saturday, day, includeCurrent)).toEqual(expected);
  });

  it('keeps the time component and crosses year boundaries', () => {
    expect(nextDayOfWeek(d(2024, 12, 28, 9, 30), DayOfWeek.Wednesday)).toEqual(
      d(2025, 1, 1, 9, 30),
    );
  });

  it('does not mutate the input', () => {
    const input = d(2024, 6, 15);
    nextDayOfWeek(input, DayOfWeek.Monday);
    expect(input).toEqual(d(2024, 6, 15));
  });
});

describe('previousDayOfWeek', () => {
  const saturday = d(2024, 6, 15);
  it.each([
    [DayOfWeek.Monday, false, d(2024, 6, 10)],
    [DayOfWeek.Friday, false, d(2024, 6, 14)],
    [DayOfWeek.Saturday, false, d(2024, 6, 8)],
    [DayOfWeek.Saturday, true, d(2024, 6, 15)],
    [DayOfWeek.Sunday, false, d(2024, 6, 9)],
  ] as const)('day %i includeCurrent=%s', (day, includeCurrent, expected) => {
    expect(previousDayOfWeek(saturday, day, includeCurrent)).toEqual(expected);
  });

  it('crosses month boundaries', () => {
    expect(previousDayOfWeek(d(2024, 7, 1), DayOfWeek.Friday)).toEqual(d(2024, 6, 28));
  });
});

describe('getAge', () => {
  it.each([
    [d(2000, 6, 15), d(2024, 6, 15), 24],
    [d(2000, 6, 15), d(2024, 6, 14), 23],
    [d(2000, 6, 15), d(2024, 6, 16), 24],
    [d(2000, 12, 31), d(2024, 1, 1), 23],
    [d(2024, 6, 15), d(2024, 6, 15), 0],
    [d(2000, 2, 29), d(2023, 2, 28), 22],
    [d(2000, 2, 29), d(2023, 3, 1), 23],
    [d(2000, 2, 29), d(2024, 2, 29), 24],
    // today.AddYears(-1) clamps 2024-02-29 to 2023-02-28, so a 2023-03-01 birth is not a year old yet.
    [d(2023, 3, 1), d(2024, 2, 29), 0],
    [d(2023, 2, 28), d(2024, 2, 29), 1],
  ])('%s → %s = %i', (birth, today, expected) => {
    expect(getAge(birth, today)).toBe(expected);
  });

  it('ignores the time of day', () => {
    expect(getAge(d(2000, 6, 15, 23, 59), d(2024, 6, 15, 0, 1))).toBe(24);
  });

  it('throws RangeError when the birth date is after the reference date', () => {
    expect(() => getAge(d(2025, 1, 1), d(2024, 1, 1))).toThrow(RangeError);
  });

  it('uses the provider date', () => {
    const provider = createFakeDateTimeProvider(d(2024, 6, 15, 10));
    expect(getAge(d(2000, 6, 15), provider)).toBe(24);
    expect(getAge(d(2000, 6, 16), provider)).toBe(23);
  });

  it("reads today in the provider's time zone", () => {
    // 2024-06-14T22:00Z is already June 15 in Istanbul (+03:00) but still June 14 in UTC.
    const at = d(2024, 6, 14, 22);
    const provider = (timeZone?: string): DateTimeProvider => ({
      utcNow: () => new Date(at),
      utcNowDate: () => d(2024, 6, 14),
      utcNowMs: () => at.getTime(),
      ...(timeZone === undefined ? {} : { timeZone }),
    });
    expect(getAge(d(2000, 6, 15), provider('Europe/Istanbul'))).toBe(24);
    expect(getAge(d(2000, 6, 15), provider('UTC'))).toBe(23);
    expect(getAge(d(2000, 6, 15), provider())).toBe(23);
    // 2024-06-15T02:00Z is still June 14 in New York (-04:00).
    const early = d(2024, 6, 15, 2);
    const ny: DateTimeProvider = {
      utcNow: () => new Date(early),
      utcNowDate: () => d(2024, 6, 15),
      utcNowMs: () => early.getTime(),
      timeZone: 'America/New_York',
    };
    expect(getAge(d(2000, 6, 15), ny)).toBe(23);
  });

  it('the fake provider reads UTC and the system provider the host zone', () => {
    expect(createFakeDateTimeProvider(d(2024, 6, 15)).timeZone).toBe('UTC');
    expect(SystemDateTimeProvider.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('msToDate', () => {
  it('converts a value to Some', () => {
    const result = msToDate(1609459200000);
    expect(Maybe.isSome(result)).toBe(true);
    expect(Maybe.getOrUndefined(result)).toEqual(d(2021, 1, 1));
  });

  it('returns None for null/undefined without default', () => {
    expect(Maybe.isNone(msToDate(null))).toBe(true);
    expect(Maybe.isNone(msToDate(undefined))).toBe(true);
  });

  it('returns the default when value is missing, ignores it otherwise', () => {
    const fallback = d(2020, 1, 1);
    expect(Maybe.getOrUndefined(msToDate(null, fallback))).toBe(fallback);
    expect(Maybe.getOrUndefined(msToDate(1609459200000, fallback))).not.toBe(fallback);
  });
});
