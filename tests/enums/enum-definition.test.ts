import {
  convertEnumName,
  defineEnum,
  type EnumMember,
  type EnumParseOptions,
  toCamelCaseName,
} from '../../src/enums/index.js';
import { ErrorType } from '../../src/errors/index.js';

const ParserStatus = defineEnum('ParserStatus', {
  Pending: { description: 'Waiting for work' },
  InProgress: { aliases: ['Started', 'Running'] },
  Completed: 'done',
  Cancelled: 'cancelled_by_user',
  HTTPStatus: {},
  Aborted: { obsolete: true },
  Unknown: { value: 100, fallback: true },
});
type ParserStatus = EnumMember<typeof ParserStatus>;

const StrictStatus = defineEnum('StrictStatus', { Open: {}, Closed: {} });

const INPUT: EnumParseOptions = { mode: 'input' };
const DATA: EnumParseOptions = { mode: 'data' };
const DATA_REJECT: EnumParseOptions = { mode: 'data', unknownValue: 'reject' };
const STRICT: EnumParseOptions = {
  caseInsensitive: false,
  acceptMemberNames: false,
  acceptNumbers: false,
};

function okValue<T>(r: { ok: true; value: T } | { ok: false }): T | undefined {
  return r.ok ? r.value : undefined;
}

describe('defineEnum metadata', () => {
  it('derives snake_case wire names and auto-increments values', () => {
    expect(ParserStatus.wireNames).toEqual([
      'pending',
      'in_progress',
      'done',
      'cancelled_by_user',
      'http_status',
      'aborted',
      'unknown',
    ]);
    expect(ParserStatus.members.map((m) => m.value)).toEqual([0, 1, 2, 3, 4, 5, 100]);
    expect(ParserStatus.fallback).toBe('Unknown');
    expect(ParserStatus.infoOf('Pending').description).toBe('Waiting for work');
    expect(ParserStatus.infoOf('Aborted').obsolete).toBe(true);
    expect(ParserStatus.keys).toEqual([
      'Pending',
      'InProgress',
      'Completed',
      'Cancelled',
      'HTTPStatus',
      'Aborted',
      'Unknown',
    ]);
  });

  it('continues numbering after an explicit value', () => {
    const E = defineEnum('E', { A: {}, B: { value: 10 }, C: {} });
    expect(E.members.map((m) => m.value)).toEqual([0, 10, 11]);
  });

  it('rejects non-int32 values and empty definitions', () => {
    expect(() => defineEnum('E', { A: { value: 1.5 } })).toThrow(RangeError);
    expect(() => defineEnum('E', { A: { value: 2 ** 31 } })).toThrow(RangeError);
    expect(() => defineEnum('E', { A: { value: 2 ** 31 - 1 }, B: {} })).toThrow(RangeError);
    expect(() => defineEnum('E', {})).toThrow(TypeError);
    expect(() => defineEnum('E', { A: '' })).toThrow(TypeError);
  });

  it('applies the naming policy', () => {
    const E = defineEnum('E', { InProgress: {}, HTTPStatus: {} }, { naming: 'kebab-case-upper' });
    expect(E.wireNames).toEqual(['IN-PROGRESS', 'HTTP-STATUS']);
  });

  it('is() is a member-name guard', () => {
    expect(ParserStatus.is('Pending')).toBe(true);
    expect(ParserStatus.is('pending')).toBe(false);
    expect(ParserStatus.is(1)).toBe(false);
  });
});

describe('infoOf', () => {
  it('throws a TypeError for a value that is not a member name', () => {
    expect(() => ParserStatus.infoOf(1 as unknown as ParserStatus)).toThrow(TypeError);
    expect(() => ParserStatus.infoOf('Nope' as ParserStatus)).toThrow(TypeError);
  });
});

describe('parse accepted in both modes', () => {
  it.each<[string, ParserStatus]>([
    ['pending', 'Pending'],
    ['PENDING', 'Pending'],
    ['in_progress', 'InProgress'],
    ['InProgress', 'InProgress'],
    ['inprogress', 'InProgress'],
    ['Started', 'InProgress'],
    ['running', 'InProgress'],
    ['done', 'Completed'],
    ['Completed', 'Completed'],
    ['cancelled_by_user', 'Cancelled'],
    ['http_status', 'HTTPStatus'],
    ['httpstatus', 'HTTPStatus'],
    ['HTTPStatus', 'HTTPStatus'],
    ['aborted', 'Aborted'],
    ['1', 'InProgress'],
    ['0', 'Pending'],
  ])('%s -> %s', (text, expected) => {
    expect(okValue(ParserStatus.parse(text, INPUT))).toBe(expected);
    expect(okValue(ParserStatus.parse(text, DATA))).toBe(expected);
  });

  it('defaults to input mode', () => {
    expect(ParserStatus.parse('unknown').ok).toBe(false);
  });
});

describe('parse malformed values', () => {
  it.each([
    '',
    ' pending',
    'pending ',
    '1.0',
    '0x1',
    '+1',
    '-0',
    '99999999999',
    '.5',
  ])('rejects %j in both modes with the raw value', (text) => {
    for (const opts of [INPUT, DATA]) {
      const r = ParserStatus.parse(text, opts);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.metadata?.get('value')).toBe(text);
    }
  });
});

describe('parse unknown values', () => {
  it.each([
    'bogus',
    '99',
    'unknown',
    '100',
    '-5',
  ])('%s is rejected in input mode and maps to Unknown in data mode', (text) => {
    expect(ParserStatus.parse(text, INPUT).ok).toBe(false);
    expect(okValue(ParserStatus.parse(text, DATA))).toBe('Unknown');
  });

  it('data mode with reject keeps known values but rejects unknown ones', () => {
    expect(ParserStatus.parse('bogus', DATA_REJECT).ok).toBe(false);
    expect(ParserStatus.parseNumber(99, DATA_REJECT).ok).toBe(false);
    expect(okValue(ParserStatus.parse('unknown', DATA_REJECT))).toBe('Unknown');
  });

  it('without a fallback member data mode rejects with all allowed values', () => {
    const r = StrictStatus.parse('bogus', DATA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.description).toBe(
        "'bogus' is not a valid StrictStatus. Allowed values: open, closed.",
      );
      expect(r.errors[0]?.code).toBe('Enum.InvalidValue');
      expect(r.errors[0]?.type).toBe(ErrorType.Validation);
    }
  });
});

describe('strict switches', () => {
  it('apply in input mode', () => {
    expect(ParserStatus.parse('PENDING', STRICT).ok).toBe(false);
    expect(ParserStatus.parse('InProgress', STRICT).ok).toBe(false);
    expect(ParserStatus.parse('1', STRICT).ok).toBe(false);
    expect(ParserStatus.parseNumber(1, STRICT).ok).toBe(false);
    expect(okValue(ParserStatus.parse('Started', STRICT))).toBe('InProgress');
    expect(ParserStatus.parse('started', STRICT).ok).toBe(false);
    expect(okValue(ParserStatus.parse('pending', STRICT))).toBe('Pending');
  });

  it('match member names exactly when only case sensitivity is turned off', () => {
    const opts: EnumParseOptions = { caseInsensitive: false };
    expect(okValue(ParserStatus.parse('InProgress', opts))).toBe('InProgress');
    expect(ParserStatus.parse('inprogress', opts).ok).toBe(false);
  });

  it('are ignored in data mode', () => {
    const opts = { ...STRICT, mode: 'data' as const };
    expect(okValue(ParserStatus.parse('PENDING', opts))).toBe('Pending');
    expect(okValue(ParserStatus.parse('InProgress', opts))).toBe('InProgress');
    expect(okValue(ParserStatus.parse('1', opts))).toBe('InProgress');
    expect(okValue(ParserStatus.parseNumber(1, opts))).toBe('InProgress');
  });
});

describe('errors', () => {
  it('input mode hides the fallback from the allowed values', () => {
    const r = ParserStatus.parse('bogus', INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.metadata?.get('allowedValues')).toEqual([
        'pending',
        'in_progress',
        'done',
        'cancelled_by_user',
        'http_status',
        'aborted',
      ]);
      expect(r.errors[0]?.metadata?.get('enumType')).toBe('ParserStatus');
    }
  });

  it('data mode lists every wire name', () => {
    const r = ParserStatus.parse('bogus', DATA_REJECT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.metadata?.get('allowedValues')).toContain('unknown');
  });

  it('uses the path as the error code', () => {
    const r = ParserStatus.parse('bogus', { path: 'order.status' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe('order.status');
      expect(r.errors[0]?.metadata?.get('path')).toBe('order.status');
    }
  });

  it('truncates long values to 64 characters', () => {
    const long = 'x'.repeat(100);
    const r = ParserStatus.parse(long);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.metadata?.get('value')).toBe(`${'x'.repeat(64)}…`);
      expect(r.errors[0]?.description.startsWith(`'${'x'.repeat(64)}…' is not a valid`)).toBe(true);
    }
  });

  it('omits the allowed list when it is empty', () => {
    const OnlyFallback = defineEnum('OnlyFallback', { Unknown: { fallback: true } });
    expect(OnlyFallback.createError('x', 'input').message).toBe("'x' is not a valid OnlyFallback.");
  });
});

describe('parseNumber', () => {
  it('maps defined values', () => {
    expect(okValue(ParserStatus.parseNumber(2, INPUT))).toBe('Completed');
  });

  it('rejects unknown values and the fallback in input mode', () => {
    expect(ParserStatus.parseNumber(99, INPUT).ok).toBe(false);
    expect(ParserStatus.parseNumber(100, INPUT).ok).toBe(false);
  });

  it('maps unknown values to the fallback in data mode', () => {
    expect(okValue(ParserStatus.parseNumber(99, DATA))).toBe('Unknown');
  });

  it('rejects numbers outside int32 and fractions even in data mode', () => {
    expect(ParserStatus.parseNumber(Number.MAX_SAFE_INTEGER, DATA).ok).toBe(false);
    expect(ParserStatus.parseNumber(1.5, DATA).ok).toBe(false);
    expect(ParserStatus.parseNumber(Number.NaN, DATA).ok).toBe(false);
  });
});

describe('format', () => {
  it('writes the wire name or numeric text', () => {
    expect(ParserStatus.format('Completed')).toBe('done');
    expect(ParserStatus.format('HTTPStatus', 'string')).toBe('http_status');
    expect(ParserStatus.format('Unknown', 'number')).toBe('100');
    expect(ParserStatus.numberOf('InProgress')).toBe(1);
  });

  it('throws for an undefined member', () => {
    expect(() => ParserStatus.format('Nope' as ParserStatus)).toThrow(
      "'Nope' is not a valid ParserStatus.",
    );
  });

  it('round-trips every member', () => {
    for (const key of ParserStatus.keys) {
      expect(okValue(ParserStatus.parse(ParserStatus.format(key), DATA))).toBe(key);
      expect(okValue(ParserStatus.parse(ParserStatus.format(key, 'number'), DATA))).toBe(key);
    }
  });
});

describe('ambiguous member sets are rejected', () => {
  it('the first member per numeric value wins (duplicate values are allowed)', () => {
    const E = defineEnum('E', { A: {}, B: {}, C: { value: 0 } });
    expect(okValue(E.parse('0'))).toBe('A');
    expect(okValue(E.parse('c'))).toBe('C');
  });

  it('throws on duplicate wire names', () => {
    expect(() => defineEnum('E', { A: 'same', B: 'same' })).toThrow(
      new TypeError(
        "Enum 'E': 'B' produces the wire name 'same', which 'A' produces as well (wire names are compared ignoring case).",
      ),
    );
  });

  it('wire names are compared ignoring case', () => {
    expect(() => defineEnum('E', { A: 'Same', B: 'SAME' })).toThrow(TypeError);
    expect(() => defineEnum('E', { InProgress: {}, In_Progress: 'IN_PROGRESS' })).toThrow(
      /produces the wire name/,
    );
  });

  it("throws when an alias equals another member's wire name", () => {
    expect(() => defineEnum('E', { A: { aliases: ['b'] }, B: {} })).toThrow(
      new TypeError(
        "Enum 'E': the alias 'b' of 'A' equals the wire name of 'B' (compared ignoring case).",
      ),
    );
  });

  it("throws when an alias equals another member's name or alias", () => {
    expect(() => defineEnum('E', { A: { aliases: ['Bee'] }, Bee: 'x' })).toThrow(
      "the alias 'Bee' of 'A' equals the member name 'Bee'",
    );
    expect(() =>
      defineEnum('E', { A: { aliases: ['shared'] }, B: { aliases: ['SHARED'] } }),
    ).toThrow("the alias 'shared' of 'A' equals an alias of 'B'");
  });

  it('an alias may repeat its own wire name or member name', () => {
    const E = defineEnum('E', { Alpha: { aliases: ['alpha', 'ALPHA'] }, B: {} });
    expect(okValue(E.parse('ALPHA'))).toBe('Alpha');
  });

  it('throws on more than one fallback member', () => {
    expect(() =>
      defineEnum('E', { A: {}, U1: { fallback: true }, U2: { fallback: true } }),
    ).toThrow(
      new TypeError(
        "Enum 'E': 'U1' is marked as fallback as well as 'U2'; keep one fallback member.",
      ),
    );
  });
});

describe('naming', () => {
  it.each([
    ['HTTPStatus', 'snake_case_lower', 'http_status'],
    ['InProgress', 'snake_case_lower', 'in_progress'],
    ['InProgress', 'snake_case_upper', 'IN_PROGRESS'],
    ['InProgress', 'kebab-case-lower', 'in-progress'],
    ['Value2Go', 'snake_case_lower', 'value2_go'],
    ['ABC', 'snake_case_lower', 'abc'],
    ['A B', 'snake_case_lower', 'a_b'],
    ['a b', 'snake_case_lower', 'a_b'],
    ['a.B', 'snake_case_lower', 'a.b'],
    ['InProgress', 'PascalCase', 'InProgress'],
    ['InProgress', 'camelCase', 'inProgress'],
    ['HTTPStatus', 'camelCase', 'httpStatus'],
    ['URL', 'camelCase', 'url'],
    ['pending', 'camelCase', 'pending'],
  ] as const)('%s with %s -> %s', (name, naming, expected) => {
    expect(convertEnumName(name, naming)).toBe(expected);
  });

  it('camel case lowercases before a space', () => {
    expect(toCamelCaseName('AB C')).toBe('ab C');
    expect(toCamelCaseName('')).toBe('');
  });
});
