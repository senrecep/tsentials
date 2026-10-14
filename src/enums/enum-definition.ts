import { type AppError, Err, ErrorMetadata } from '../errors/index.js';
import { Result } from '../result/index.js';
import { convertEnumName, type EnumNaming } from './naming.js';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const MAX_NUMERIC_TEXT_LENGTH = 20;
const MAX_ERROR_VALUE_LENGTH = 64;

/** Per-member options. */
export interface EnumMemberOptions {
  /** Explicit wire name. Defaults to the member name converted with the definition's naming policy. */
  readonly wire?: string | undefined;
  /** Underlying int32 value. Defaults to previous value + 1 (the first member defaults to 0). */
  readonly value?: number | undefined;
  /** Extra names accepted when parsing. Never used when formatting. */
  readonly aliases?: readonly string[] | undefined;
  /**
   * Marks the member that unknown data-mode values map to. At most one member may be flagged
   * (`defineEnum` throws otherwise).
   */
  readonly fallback?: boolean | undefined;
  readonly description?: string | undefined;
  readonly obsolete?: boolean | undefined;
}

/** Definition-wide options. */
export interface DefineEnumOptions {
  /** Naming policy for wire names. Default `'snake_case_lower'`. */
  readonly naming?: EnumNaming | undefined;
}

/** Resolved metadata of one member. */
export interface EnumMemberInfo<K extends string> {
  readonly name: K;
  readonly wireName: string;
  readonly value: number;
  /** Invariant decimal text of {@link value}. */
  readonly numericText: string;
  readonly aliases: readonly string[];
  readonly description: string | undefined;
  readonly obsolete: boolean;
  readonly fallback: boolean;
}

/**
 * `'input'` is for untrusted client input: the fallback member is never accepted and the
 * switches in {@link EnumParseOptions} apply. `'data'` is for stored or upstream data:
 * everything is accepted, and unknown values may map to the fallback member.
 */
export type EnumParseMode = 'input' | 'data';

/** What to do with an unknown value in data mode. */
export type EnumUnknownValueHandling = 'useFallback' | 'reject';

/** Parse switches. All switches default to permissive. */
export interface EnumParseOptions {
  /** Default `'input'`. */
  readonly mode?: EnumParseMode | undefined;
  /** Becomes the error code and the `path` metadata. Default code `'Enum.InvalidValue'`. */
  readonly path?: string | undefined;
  /** Input mode only: accept int32 numeric text / numbers. Default `true`. */
  readonly acceptNumbers?: boolean | undefined;
  /** Input mode only: accept member names in addition to wire names. Default `true`. */
  readonly acceptMemberNames?: boolean | undefined;
  /** Input mode only: compare names ignoring case. Default `true`. */
  readonly caseInsensitive?: boolean | undefined;
  /** Data mode only. Default `'useFallback'`. */
  readonly unknownValue?: EnumUnknownValueHandling | undefined;
}

/** Output format of {@link EnumDefinition.format}. */
export type EnumFormat = 'string' | 'number';

/** Details of a rejected enum value. */
export interface EnumValueError {
  readonly enumType: string;
  /** The rejected value, truncated to 64 characters plus `…`. */
  readonly value: string;
  readonly allowedValues: readonly string[];
  readonly path: string | undefined;
  readonly message: string;
}

/** A runtime enum definition. Members are represented by their names (`K`). */
export interface EnumDefinition<K extends string> {
  readonly name: string;
  readonly keys: readonly K[];
  readonly members: readonly EnumMemberInfo<K>[];
  /** Wire names of all members, in declaration order. */
  readonly wireNames: readonly string[];
  readonly fallback: K | undefined;
  /** Parses a wire name, member name, alias or int32 numeric text. */
  parse(text: string, options?: EnumParseOptions): Result<K>;
  /** Parses an underlying int32 value. */
  parseNumber(value: number, options?: EnumParseOptions): Result<K>;
  /** Formats a member as its wire name (default) or numeric text. Throws for an unknown member. */
  format(member: K, format?: EnumFormat): string;
  /** Underlying int32 value of a member. Throws for an unknown member. */
  numberOf(member: K): number;
  infoOf(member: K): EnumMemberInfo<K>;
  /** Type guard: `value` is a member name of this enum. */
  is(value: unknown): value is K;
  /** Builds the rejection details for `value`. */
  createError(value: string, mode?: EnumParseMode, path?: string): EnumValueError;
}

/** Member name union of a definition: `type Status = EnumMember<typeof Status>`. */
export type EnumMember<D> = D extends EnumDefinition<infer K> ? K : never;

/** Converts an {@link EnumValueError} into a validation {@link AppError}. */
export function enumValueErrorToAppError(error: EnumValueError): AppError {
  return Err.validation(
    error.path ?? 'Enum.InvalidValue',
    error.message,
    ErrorMetadata.fromRecord({
      enumType: error.enumType,
      value: error.value,
      allowedValues: error.allowedValues,
      path: error.path,
    }),
  );
}

function isInt32(n: number): boolean {
  return Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX;
}

function foldCase(s: string): string {
  return s.toUpperCase();
}

function addFirst<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key)) map.set(key, value);
}

/**
 * Rejects ambiguous member sets (all comparisons ignore case, because
 * data-mode reads match ignoring case):
 * - two members produce the same wire name;
 * - an alias equals the wire name, member name or an alias of another member;
 * - more than one fallback member.
 */
function assertMembersUnambiguous<K extends string>(
  enumName: string,
  infos: readonly EnumMemberInfo<K>[],
): void {
  const wireOwners = new Map<string, EnumMemberInfo<K>>();
  for (const info of infos) {
    const first = wireOwners.get(foldCase(info.wireName));
    if (first !== undefined) {
      throw new TypeError(
        `Enum '${enumName}': '${info.name}' produces the wire name '${info.wireName}', which '${first.name}' produces as well (wire names are compared ignoring case).`,
      );
    }
    wireOwners.set(foldCase(info.wireName), info);
  }

  for (const info of infos) {
    for (const alias of info.aliases) {
      const folded = foldCase(alias);
      for (const other of infos) {
        if (other === info) continue;
        const collision =
          foldCase(other.wireName) === folded
            ? `the wire name of '${other.name}'`
            : foldCase(other.name) === folded
              ? `the member name '${other.name}'`
              : other.aliases.some((a) => foldCase(a) === folded)
                ? `an alias of '${other.name}'`
                : undefined;
        if (collision !== undefined) {
          throw new TypeError(
            `Enum '${enumName}': the alias '${alias}' of '${info.name}' equals ${collision} (compared ignoring case).`,
          );
        }
      }
    }
  }

  const fallbacks = infos.filter((i) => i.fallback);
  if (fallbacks.length > 1) {
    const [first, ...others] = fallbacks.map((i) => i.name);
    throw new TypeError(
      `Enum '${enumName}': '${first}' is marked as fallback as well as '${others.join("', '")}'; keep one fallback member.`,
    );
  }
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_VALUE_LENGTH
    ? `${value.slice(0, MAX_ERROR_VALUE_LENGTH)}…`
    : value;
}

function isNumericStart(c: string): boolean {
  return (c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.';
}

function hasOuterWhitespace(text: string): boolean {
  return text.trim().length !== text.length;
}

/**
 * Defines a runtime enum with wire names, aliases and an optional fallback member

 *
 * @example
 * const Status = defineEnum('Status', {
 *   Pending: {},
 *   InProgress: { aliases: ['Started'] },
 *   Completed: 'done',
 *   Unknown: { value: 100, fallback: true },
 * });
 * type Status = EnumMember<typeof Status>;
 * Status.parse('in_progress');                    // success('InProgress')
 * Status.parse('bogus', { mode: 'data' });        // success('Unknown')
 * Status.format('Completed');                     // 'done'
 */
export function defineEnum<K extends string>(
  name: string,
  members: { readonly [P in K]: EnumMemberOptions | string },
  options: DefineEnumOptions = {},
): EnumDefinition<K> {
  const naming = options.naming ?? 'snake_case_lower';
  const keys = Object.keys(members) as K[];
  if (keys.length === 0) throw new TypeError(`Enum '${name}' must define at least one member.`);

  const infos: EnumMemberInfo<K>[] = [];
  let next = 0;
  for (const key of keys) {
    const raw = members[key];
    const opts: EnumMemberOptions = typeof raw === 'string' ? { wire: raw } : raw;
    const value = opts.value ?? next;
    if (!isInt32(value)) {
      throw new RangeError(`Enum '${name}' member '${key}' value ${value} is not an int32.`);
    }
    next = value + 1;
    const wireName = opts.wire ?? convertEnumName(key, naming);
    if (wireName === '')
      throw new TypeError(`Enum '${name}' member '${key}' has an empty wire name.`);
    infos.push(
      Object.freeze({
        name: key,
        wireName,
        value,
        numericText: String(value),
        aliases: Object.freeze([...(opts.aliases ?? [])]),
        description: opts.description,
        obsolete: opts.obsolete === true,
        fallback: opts.fallback === true,
      }),
    );
  }

  assertMembersUnambiguous(name, infos);

  const byName = new Map<string, EnumMemberInfo<K>>();
  const wireExact = new Map<string, EnumMemberInfo<K>>();
  const wireIgnoreCase = new Map<string, EnumMemberInfo<K>>();
  const nameExact = new Map<string, EnumMemberInfo<K>>();
  const nameIgnoreCase = new Map<string, EnumMemberInfo<K>>();
  const aliasExact = new Map<string, EnumMemberInfo<K>>();
  const aliasIgnoreCase = new Map<string, EnumMemberInfo<K>>();
  const byRaw = new Map<number, EnumMemberInfo<K>>();
  for (const info of infos) {
    byName.set(info.name, info);
    addFirst(wireExact, info.wireName, info);
    addFirst(wireIgnoreCase, foldCase(info.wireName), info);
    addFirst(nameExact, info.name, info);
    addFirst(nameIgnoreCase, foldCase(info.name), info);
    for (const alias of info.aliases) {
      addFirst(aliasExact, alias, info);
      addFirst(aliasIgnoreCase, foldCase(alias), info);
    }
    if (!byRaw.has(info.value)) byRaw.set(info.value, info);
  }
  const fallbackInfo = infos.find((i) => i.fallback);
  const wireNames = Object.freeze(infos.map((i) => i.wireName));
  const inputAllowed = Object.freeze(
    infos.filter((i) => i !== fallbackInfo).map((i) => i.wireName),
  );

  const createError = (
    value: string,
    mode: EnumParseMode = 'data',
    path?: string,
  ): EnumValueError => {
    const allowedValues = mode === 'input' ? inputAllowed : wireNames;
    const shown = truncate(value);
    const message =
      allowedValues.length === 0
        ? `'${shown}' is not a valid ${name}.`
        : `'${shown}' is not a valid ${name}. Allowed values: ${allowedValues.join(', ')}.`;
    return Object.freeze({ enumType: name, value: shown, allowedValues, path, message });
  };

  interface Ctx {
    readonly input: boolean;
    readonly mode: EnumParseMode;
    readonly path: string | undefined;
    readonly acceptNumbers: boolean;
    readonly acceptMemberNames: boolean;
    readonly ignoreCase: boolean;
    readonly useFallback: boolean;
  }

  const context = (o: EnumParseOptions | undefined): Ctx => {
    const mode = o?.mode ?? 'input';
    const input = mode === 'input';
    return {
      input,
      mode,
      path: o?.path,
      acceptNumbers: !input || (o?.acceptNumbers ?? true),
      acceptMemberNames: !input || (o?.acceptMemberNames ?? true),
      ignoreCase: !input || (o?.caseInsensitive ?? true),
      useFallback: !input && (o?.unknownValue ?? 'useFallback') === 'useFallback',
    };
  };

  const fail = (value: string, ctx: Ctx): Result<K> =>
    Result.failure(enumValueErrorToAppError(createError(value, ctx.mode, ctx.path)));

  const accept = (info: EnumMemberInfo<K>, value: string, ctx: Ctx): Result<K> =>
    ctx.input && info === fallbackInfo ? fail(value, ctx) : Result.success(info.name);

  const useFallback = (value: string, ctx: Ctx): Result<K> =>
    ctx.useFallback && fallbackInfo !== undefined
      ? Result.success(fallbackInfo.name)
      : fail(value, ctx);

  const findByName = (text: string, ctx: Ctx): EnumMemberInfo<K> | undefined => {
    const folded = foldCase(text);
    const found =
      wireExact.get(text) ??
      (ctx.ignoreCase ? wireIgnoreCase.get(folded) : undefined) ??
      (ctx.acceptMemberNames
        ? ctx.ignoreCase
          ? nameIgnoreCase.get(folded)
          : nameExact.get(text)
        : undefined);
    return found ?? (ctx.ignoreCase ? aliasIgnoreCase.get(folded) : aliasExact.get(text));
  };

  const acceptRaw = (value: number, text: string, ctx: Ctx): Result<K> => {
    const info = byRaw.get(value);
    return info !== undefined ? accept(info, text, ctx) : useFallback(text, ctx);
  };

  const parse = (text: string, o?: EnumParseOptions): Result<K> => {
    const ctx = context(o);
    if (text === '') return fail('', ctx);
    const found = findByName(text, ctx);
    if (found !== undefined) return accept(found, text, ctx);
    if (isNumericStart(text.charAt(0))) {
      if (
        !ctx.acceptNumbers ||
        text.length > MAX_NUMERIC_TEXT_LENGTH ||
        !/^-?[0-9]+$/.test(text) ||
        text === '-0'
      ) {
        return fail(text, ctx);
      }
      const n = Number(text);
      return isInt32(n) ? acceptRaw(n, text, ctx) : fail(text, ctx);
    }
    if (hasOuterWhitespace(text)) return fail(text, ctx);
    return useFallback(text, ctx);
  };

  const parseNumber = (value: number, o?: EnumParseOptions): Result<K> => {
    const ctx = context(o);
    const text = String(value);
    if (!ctx.acceptNumbers || !isInt32(value)) return fail(text, ctx);
    return acceptRaw(value, text, ctx);
  };

  const infoOf = (member: K): EnumMemberInfo<K> => {
    const info = typeof member === 'string' ? byName.get(member) : undefined;
    if (info === undefined) throw new TypeError(createError(String(member)).message);
    return info;
  };

  return Object.freeze({
    name,
    keys: Object.freeze([...keys]),
    members: Object.freeze(infos),
    wireNames,
    fallback: fallbackInfo?.name,
    parse,
    parseNumber,
    format: (member: K, format: EnumFormat = 'string') => {
      const info = infoOf(member);
      return format === 'number' ? info.numericText : info.wireName;
    },
    numberOf: (member: K) => infoOf(member).value,
    infoOf,
    is: (value: unknown): value is K => typeof value === 'string' && byName.has(value),
    createError,
  });
}
