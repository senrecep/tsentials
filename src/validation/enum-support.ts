/**
 * Runtime enum metadata for the enum validators.
 *
 * TypeScript `enum`s compile to plain objects; numeric enums also carry reverse mappings
 * (`{ 0: 'Red', Red: 0 }`) which are filtered out here. `as const` objects work too.
 * An `EnumDefinition` from `tsentials/enums` is used through its own `parse` / `parseNumber`.
 */

import type { EnumDefinition } from '../enums/enum-definition.js';
import type { Result } from '../result/result.js';

/** A TypeScript `enum` object or an `as const` object of string / number members. */
export type EnumLike = { readonly [key: string]: string | number };

interface EnumInfo {
  /** Display text of each member, in declaration order (string members: value, numeric: name). */
  readonly allowed: readonly string[];
  readonly values: ReadonlySet<string | number>;
  readonly nameByNumber: ReadonlyMap<number, string>;
  /** OR of every integer member value (flags mask). */
  readonly mask: bigint;
}

const cache = new WeakMap<object, EnumInfo>();

const isReverseMapping = (enumObject: EnumLike, key: string, value: string | number): boolean =>
  typeof value === 'string' && String(Number(key)) === key && enumObject[value] === Number(key);

function infoOf(enumObject: EnumLike): EnumInfo {
  const cached = cache.get(enumObject);
  if (cached) return cached;

  const allowed: string[] = [];
  const values = new Set<string | number>();
  const nameByNumber = new Map<number, string>();
  let mask = 0n;
  for (const [key, value] of Object.entries(enumObject)) {
    if (isReverseMapping(enumObject, key, value)) continue;
    values.add(value);
    if (typeof value === 'number') {
      allowed.push(key);
      if (!nameByNumber.has(value)) nameByNumber.set(value, key);
      if (Number.isInteger(value)) mask |= BigInt(value);
    } else {
      allowed.push(value);
    }
  }
  const info: EnumInfo = { allowed, values, nameByNumber, mask };
  cache.set(enumObject, info);
  return info;
}

/** Display text of a value: defined numeric members by name, everything else as-is. */
function textOf(info: EnumInfo, value: string | number): string {
  if (typeof value === 'number') return info.nameByNumber.get(value) ?? String(value);
  return value;
}

export function isDefinedMember(enumObject: EnumLike, value: string | number): boolean {
  return infoOf(enumObject).values.has(value);
}

/**
 * True when every set bit of `value` belongs to a declared member.
 * String values are only valid when they are declared members; non-integer numbers never are.
 */
export function hasOnlyDefinedBits(enumObject: EnumLike, value: string | number): boolean {
  const info = infoOf(enumObject);
  if (typeof value === 'string') return info.values.has(value);
  if (!Number.isInteger(value)) return false;
  return (BigInt(value) & ~info.mask) === 0n;
}

/** Same limit as the C# enum errors and `EnumDefinition.createError`. */
const MAX_ERROR_VALUE_LENGTH = 64;

function enumMessage(valueText: string, enumName: string, allowed: readonly string[]): string {
  const shown =
    valueText.length > MAX_ERROR_VALUE_LENGTH
      ? `${valueText.slice(0, MAX_ERROR_VALUE_LENGTH)}…`
      : valueText;
  return allowed.length === 0
    ? `'${shown}' is not a valid ${enumName}.`
    : `'${shown}' is not a valid ${enumName}. Allowed values: ${allowed.join(', ')}.`;
}

/** Message listing every declared member. */
export function invalidEnumMessage(
  enumObject: EnumLike,
  enumName: string,
  value: string | number,
): string {
  const info = infoOf(enumObject);
  return enumMessage(textOf(info, value), enumName, info.allowed);
}

/** Message listing only the allowed subset. */
export function notAllowedEnumMessage(
  enumObject: EnumLike,
  enumName: string,
  value: string | number,
  allowed: readonly (string | number)[],
): string {
  const info = infoOf(enumObject);
  return enumMessage(
    textOf(info, value),
    enumName,
    allowed.map((v) => textOf(info, v)),
  );
}

/** True for an `EnumDefinition` (plain enum objects never hold functions). */
export function isEnumDefinition(
  source: EnumLike | EnumDefinition<string>,
): source is EnumDefinition<string> {
  return typeof (source as { parse?: unknown }).parse === 'function';
}

/** Parses in input mode: wire names, member names, aliases and int32 values; never the fallback. */
export function parseWithDefinition(
  definition: EnumDefinition<string>,
  value: string | number,
): Result<string> {
  return typeof value === 'number' ? definition.parseNumber(value) : definition.parse(value);
}

/** Message listing the given members of a definition by wire name. */
export function notAllowedDefinitionMessage(
  definition: EnumDefinition<string>,
  value: string | number,
  allowed: readonly string[],
): string {
  return enumMessage(
    String(value),
    definition.name,
    allowed.map((member) => definition.format(member)),
  );
}
