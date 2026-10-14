import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import type { Result } from '../../src/result/result.js';
import type { RuleChain } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

enum OrderStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Unknown = 'unknown',
}

enum PlainColor {
  Red = 0,
  Green = 1,
  Blue = 2,
}

enum PlainAccess {
  None = 0,
  Read = 1,
  Write = 2,
}

const Channels = { None: 0, Email: 1, Sms: 2, Push: 4 } as const;
type Channels = (typeof Channels)[keyof typeof Channels];

enum Empty {}

const validate = <V>(value: V, configure: (chain: RuleChain<V>) => void): Result<{ value: V }> =>
  Validator.validate({ value }, (rules) => {
    configure(rules.for('value') as RuleChain<V>);
  });

const first = (result: Result<unknown>): AppError | undefined =>
  result.ok ? undefined : result.errors[0];

describe('enum validators', () => {
  describe('isDefinedEnum', () => {
    it.each([
      OrderStatus.Pending,
      OrderStatus.InProgress,
      OrderStatus.Unknown,
    ])('passes for the string member %s', (value) => {
      expect(validate(value, (c) => c.isDefinedEnum(OrderStatus, 'OrderStatus')).ok).toBe(true);
    });

    it('fails for an undefined string value, listing the member values', () => {
      const error = first(
        validate('shipped' as OrderStatus, (c) => c.isDefinedEnum(OrderStatus, 'OrderStatus')),
      );
      expect(error?.code).toBe('value.IsDefinedEnum');
      expect(error?.type).toBe('Validation');
      expect(error?.description).toBe(
        "'shipped' is not a valid OrderStatus. Allowed values: pending, in_progress, unknown.",
      );
    });

    it('numeric enums: members pass, undefined values fail listing member names', () => {
      expect(validate(PlainColor.Green, (c) => c.isDefinedEnum(PlainColor, 'PlainColor')).ok).toBe(
        true,
      );
      const error = first(
        validate(7 as PlainColor, (c) => c.isDefinedEnum(PlainColor, 'PlainColor')),
      );
      expect(error?.code).toBe('value.IsDefinedEnum');
      expect(error?.description).toBe(
        "'7' is not a valid PlainColor. Allowed values: Red, Green, Blue.",
      );
    });

    it('numeric enums do not accept member names (reverse mappings are ignored)', () => {
      expect(
        validate('Red' as unknown as PlainColor, (c) => c.isDefinedEnum(PlainColor, 'PlainColor'))
          .ok,
      ).toBe(false);
    });

    it('works with `as const` objects', () => {
      expect(
        validate<Channels>(Channels.Sms, (c) => c.isDefinedEnum(Channels, 'Channels')).ok,
      ).toBe(true);
      expect(
        first(validate(8 as Channels, (c) => c.isDefinedEnum(Channels, 'Channels')))?.description,
      ).toBe("'8' is not a valid Channels. Allowed values: None, Email, Sms, Push.");
    });

    it('flag combinations are not members (use hasOnlyDefinedFlags)', () => {
      expect(
        validate((PlainAccess.Read | PlainAccess.Write) as PlainAccess, (c) =>
          c.isDefinedEnum(PlainAccess, 'PlainAccess'),
        ).ok,
      ).toBe(false);
    });

    it('omits the allowed list for an empty enum', () => {
      expect(
        first(validate(1 as unknown as Empty, (c) => c.isDefinedEnum(Empty, 'Empty')))?.description,
      ).toBe("'1' is not a valid Empty.");
    });

    it('uses a custom message or AppError', () => {
      const withMessage = first(
        validate('x' as OrderStatus, (c) =>
          c.isDefinedEnum(OrderStatus, 'OrderStatus', 'bad status'),
        ),
      );
      const custom = Err.validation('status.custom', 'custom');
      const withError = first(
        validate('x' as OrderStatus, (c) => c.isDefinedEnum(OrderStatus, 'OrderStatus', custom)),
      );
      expect(withMessage?.code).toBe('value.IsDefinedEnum');
      expect(withMessage?.description).toBe('bad status');
      expect(withError).toBe(custom);
    });

    it('skips null and checks present nullable values', () => {
      const check = (value: OrderStatus | null, message?: AppError) =>
        validate(value, (c) => c.isDefinedEnum(OrderStatus, 'OrderStatus', message));
      const custom = Err.validation('custom', 'custom');
      expect(check(null).ok).toBe(true);
      expect(check(OrderStatus.Pending).ok).toBe(true);
      expect(first(check('x' as OrderStatus))?.description).toMatch(
        /^'x' is not a valid OrderStatus\./,
      );
      expect(first(check('x' as OrderStatus, custom))).toBe(custom);
    });
  });

  describe('isOneOf', () => {
    it('passes for an allowed value', () => {
      const result = validate(OrderStatus.InProgress, (c) =>
        c.isOneOf(OrderStatus, 'OrderStatus', [OrderStatus.Pending, OrderStatus.InProgress]),
      );
      expect(result.ok).toBe(true);
    });

    it('lists only the allowed values', () => {
      const error = first(
        validate(OrderStatus.Pending, (c) =>
          c.isOneOf(OrderStatus, 'OrderStatus', [OrderStatus.InProgress]),
        ),
      );
      expect(error?.code).toBe('value.IsOneOf');
      expect(error?.type).toBe('Validation');
      expect(error?.description).toBe(
        "'pending' is not a valid OrderStatus. Allowed values: in_progress.",
      );
    });

    it('renders undefined values as-is', () => {
      expect(
        first(
          validate('x' as OrderStatus, (c) =>
            c.isOneOf(OrderStatus, 'OrderStatus', [OrderStatus.Pending]),
          ),
        )?.description,
      ).toBe("'x' is not a valid OrderStatus. Allowed values: pending.");
    });

    it('uses member names for numeric enums', () => {
      const error = first(
        validate(PlainColor.Red, (c) =>
          c.isOneOf(PlainColor, 'PlainColor', [PlainColor.Green, PlainColor.Blue]),
        ),
      );
      expect(error?.description).toBe(
        "'Red' is not a valid PlainColor. Allowed values: Green, Blue.",
      );
    });

    it('uses a custom message or AppError', () => {
      const allowed = [OrderStatus.InProgress];
      const custom = Err.validation('custom', 'custom');
      const withMessage = first(
        validate(OrderStatus.Pending, (c) =>
          c.isOneOf(OrderStatus, 'OrderStatus', allowed, 'not now'),
        ),
      );
      expect(withMessage?.code).toBe('value.IsOneOf');
      expect(withMessage?.description).toBe('not now');
      expect(
        first(
          validate(OrderStatus.Pending, (c) =>
            c.isOneOf(OrderStatus, 'OrderStatus', allowed, custom),
          ),
        ),
      ).toBe(custom);
      expect(
        validate(OrderStatus.InProgress, (c) =>
          c.isOneOf(OrderStatus, 'OrderStatus', allowed, custom),
        ).ok,
      ).toBe(true);
    });

    it('skips null', () => {
      const custom = Err.validation('custom', 'custom');
      expect(
        validate<OrderStatus | null>(null, (c) =>
          c.isOneOf(OrderStatus, 'OrderStatus', [OrderStatus.InProgress], custom),
        ).ok,
      ).toBe(true);
    });

    it('throws a TypeError when allowed is not an array', () => {
      expect(() =>
        validate(OrderStatus.Pending, (c) =>
          c.isOneOf(OrderStatus, 'OrderStatus', null as unknown as OrderStatus[], 'message'),
        ),
      ).toThrow(TypeError);
    });
  });

  describe('hasOnlyDefinedFlags', () => {
    it.each([
      Channels.None,
      Channels.Email | Channels.Sms | Channels.Push,
    ])('passes for defined bits %d', (value) => {
      expect(validate(value, (c) => c.hasOnlyDefinedFlags(Channels, 'Channels')).ok).toBe(true);
    });

    it('fails for undefined bits', () => {
      const error = first(validate(17, (c) => c.hasOnlyDefinedFlags(Channels, 'Channels')));
      expect(error?.code).toBe('value.HasOnlyDefinedFlags');
      expect(error?.description).toBe(
        "'17' is not a valid Channels. Allowed values: None, Email, Sms, Push.",
      );
    });

    it('uses the numeric enum mask', () => {
      expect(
        validate(PlainAccess.Read | PlainAccess.Write, (c) =>
          c.hasOnlyDefinedFlags(PlainAccess, 'PlainAccess'),
        ).ok,
      ).toBe(true);
      expect(
        first(validate(5, (c) => c.hasOnlyDefinedFlags(PlainAccess, 'PlainAccess')))?.description,
      ).toBe("'5' is not a valid PlainAccess. Allowed values: None, Read, Write.");
    });

    it('rejects non-integer numbers and undeclared strings', () => {
      expect(validate(1.5, (c) => c.hasOnlyDefinedFlags(PlainAccess, 'PlainAccess')).ok).toBe(
        false,
      );
      expect(validate('x', (c) => c.hasOnlyDefinedFlags(OrderStatus, 'OrderStatus')).ok).toBe(
        false,
      );
      expect(validate('pending', (c) => c.hasOnlyDefinedFlags(OrderStatus, 'OrderStatus')).ok).toBe(
        true,
      );
    });

    it('uses a custom message / AppError and skips null', () => {
      const custom = Err.validation('custom', 'custom');
      const withMessage = first(
        validate(8, (c) => c.hasOnlyDefinedFlags(Channels, 'Channels', 'bad flags')),
      );
      expect(withMessage?.code).toBe('value.HasOnlyDefinedFlags');
      expect(withMessage?.description).toBe('bad flags');
      expect(first(validate(8, (c) => c.hasOnlyDefinedFlags(Channels, 'Channels', custom)))).toBe(
        custom,
      );
      expect(
        validate<number | null>(null, (c) => c.hasOnlyDefinedFlags(Channels, 'Channels')).ok,
      ).toBe(true);
      expect(
        first(validate<number | null>(8, (c) => c.hasOnlyDefinedFlags(Channels, 'Channels')))?.code,
      ).toBe('value.HasOnlyDefinedFlags');
    });
  });

  it('later enum rules do not run after a failure', () => {
    const result = validate(42 as PlainColor, (c) =>
      c
        .isDefinedEnum(PlainColor, 'PlainColor')
        .isOneOf(PlainColor, 'PlainColor', [PlainColor.Red])
        .hasOnlyDefinedFlags(PlainColor, 'PlainColor'),
    );
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['value.IsDefinedEnum']);
  });
});
