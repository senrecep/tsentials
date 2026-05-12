/**
 * Abstraction for current time retrieval, enabling testable time in domain logic.
 *
 * TypeScript adaptation of CSharpEssentials.Time.IDateTimeProvider.
 * Wraps the system clock behind an interface so tests can inject a fixed time.
 *
 * @example
 * // Production
 * const provider: DateTimeProvider = SystemDateTimeProvider;
 *
 * // Testing
 * const provider = createFakeDateTimeProvider(new Date('2024-01-01'));
 */
export interface DateTimeProvider {
  /** Current UTC time as a Date object. */
  utcNow(): Date;
  /** Current UTC date (year, month, day only — time zeroed). */
  utcNowDate(): Date;
  /** Current timestamp in milliseconds (Date.now() equivalent). */
  utcNowMs(): number;
}

/**
 * Production implementation — delegates to system clock.
 * Equivalent to C#'s `DateTimeProvider` wrapping `TimeProvider.System`.
 */
export const SystemDateTimeProvider: DateTimeProvider = {
  utcNow(): Date {
    return new Date();
  },
  utcNowDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  },
  utcNowMs(): number {
    return Date.now();
  },
};

/**
 * Creates a test double that returns a fixed time.
 * Equivalent to using `Microsoft.Extensions.Time.Testing.FakeTimeProvider`.
 *
 * @example
 * const fake = createFakeDateTimeProvider(new Date('2024-06-01T12:00:00Z'));
 * expect(fake.utcNow()).toEqual(new Date('2024-06-01T12:00:00Z'));
 */
export function createFakeDateTimeProvider(fixed: Date): DateTimeProvider & {
  advance(ms: number): void;
  setTime(date: Date): void;
} {
  let current = new Date(fixed.getTime());

  return {
    utcNow(): Date { return new Date(current.getTime()); },
    utcNowDate(): Date {
      return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
    },
    utcNowMs(): number { return current.getTime(); },
    advance(ms: number): void { current = new Date(current.getTime() + ms); },
    setTime(date: Date): void { current = new Date(date.getTime()); },
  };
}
