import { Maybe } from '../maybe/maybe.js';
import type { DateTimeProvider } from './date-time-provider.js';

/**
 * Day of the week with the same numbering as JavaScript `Date.getUTCDay()`:
 * Sunday = 0 … Saturday = 6.
 */
export const DayOfWeek = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
} as const;

export type DayOfWeek = (typeof DayOfWeek)[keyof typeof DayOfWeek];

/** A time of day, read from the UTC clock of a `Date`. */
export interface TimeOnly {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

const MS_PER_DAY = 86_400_000;

const daysUntil = (from: number, to: number, includeCurrent: boolean): number => {
  const days = (to - from + 7) % 7;
  return days === 0 && !includeCurrent ? 7 : days;
};

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * MS_PER_DAY);

/**
 * The next `dayOfWeek` after `date`. When `date` already falls on `dayOfWeek`
 * it returns `date + 7 days`, or `date` itself with `includeCurrent`. The weekday is read in UTC and the
 * UTC time of day is kept. Returns a new `Date`.
 *
 * @example
 * nextDayOfWeek(new Date('2024-06-15'), DayOfWeek.Monday) // 2024-06-17 (from a Saturday)
 */
export function nextDayOfWeek(date: Date, dayOfWeek: DayOfWeek, includeCurrent = false): Date {
  return addDays(date, daysUntil(date.getUTCDay(), dayOfWeek, includeCurrent));
}

/**
 * The previous `dayOfWeek` before `date`. When `date` already falls on
 * `dayOfWeek` it returns `date - 7 days`, or `date` itself with `includeCurrent`. The weekday is read in
 * UTC and the UTC time of day is kept. Returns a new `Date`.
 */
export function previousDayOfWeek(date: Date, dayOfWeek: DayOfWeek, includeCurrent = false): Date {
  return addDays(date, -daysUntil(dayOfWeek, date.getUTCDay(), includeCurrent));
}

/** The UTC calendar date of `date` at UTC midnight. Returns a new `Date`. */
export function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The UTC time of day of `date`. */
export function toTimeOnly(date: Date): TimeOnly {
  return {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Packs a calendar date into a comparable number (yyyymmdd). */
const ymd = (year: number, month: number, day: number): number => year * 10_000 + month * 100 + day;

/** Year, month (1-12) and day of `instant` as seen in the IANA time zone `timeZone`. */
const calendarDateIn = (instant: Date, timeZone: string): [number, number, number] => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return [part('year'), part('month'), part('day')];
};

/**
 * Completed years between `birthDate` and the reference date. Both dates are read as UTC
 * calendar dates; time of day is ignored. A Feb 29 birthday counts as completed on Feb 28 in
 * non-leap years only when the reference date is past Feb 28 (Feb 29 clamps to Feb 28).
 *
 * The reference date is either a `Date` (read as a UTC calendar date) or a `DateTimeProvider`. For a
 * provider, today is the calendar date of `utcNow()` in the provider's `timeZone`; a provider without `timeZone` uses its `utcNowDate()`.
 * `SystemDateTimeProvider` uses the host's local zone and `createFakeDateTimeProvider` uses UTC.
 *
 * @throws RangeError when `birthDate` is after the reference date.
 *
 * @example
 * getAge(new Date('2000-06-15'), new Date('2024-06-14')) // 23
 */
export function getAge(birthDate: Date, today: Date | DateTimeProvider): number {
  const utcDate = (date: Date): [number, number, number] => [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  ];
  const [ty, tm, td] =
    today instanceof Date
      ? utcDate(today)
      : today.timeZone === undefined
        ? utcDate(today.utcNowDate())
        : calendarDateIn(today.utcNow(), today.timeZone);
  const by = birthDate.getUTCFullYear();
  const bm = birthDate.getUTCMonth() + 1;
  const bd = birthDate.getUTCDate();

  const birth = ymd(by, bm, bd);
  if (birth > ymd(ty, tm, td)) {
    throw new RangeError('Birth date cannot be after the reference date. (Parameter: birthDate)');
  }

  const age = ty - by;
  // today.AddYears(-age): Feb 29 becomes Feb 28 when the target year is not a leap year.
  const shiftedYear = ty - age;
  const shiftedDay = tm === 2 && td === 29 && !isLeapYear(shiftedYear) ? 28 : td;
  return birth > ymd(shiftedYear, tm, shiftedDay) ? age - 1 : age;
}

/**
 * Converts Unix milliseconds to a `Date`. `null`/`undefined` gives `defaultValue`
 * as `Some`, or `None` when no default is given.
 *
 * @example
 * msToDate(1609459200000)        // Some(2021-01-01T00:00:00Z)
 * msToDate(undefined)            // None
 * msToDate(null, new Date(0))    // Some(1970-01-01T00:00:00Z)
 */
export function msToDate(value: number | null | undefined, defaultValue?: Date): Maybe<Date> {
  if (value !== null && value !== undefined) return Maybe.some(new Date(value));
  return defaultValue === undefined ? Maybe.none<Date>() : Maybe.some(defaultValue);
}
