/**
 * Wire-name policies. The separated and camel-case policies are ports of
 * `System.Text.Json`'s `JsonNamingPolicy` algorithms, so `HTTPStatus` becomes `http_status`.
 */
export type EnumNaming =
  | 'snake_case_lower'
  | 'snake_case_upper'
  | 'kebab-case-lower'
  | 'kebab-case-upper'
  | 'camelCase'
  | 'PascalCase';

const UPPER = /^\p{Lu}$/u;
const LOWER = /^\p{Ll}$/u;
const DIGIT = /^\p{Nd}$/u;
const SPACE = /^\p{Zs}$/u;

enum State {
  NotStarted,
  UppercaseLetter,
  LowercaseLetterOrDigit,
  SpaceSeparator,
}

/** Splits a member name into separated words (UTF-16 code units). */
export function toSeparated(name: string, separator: string, lowercase: boolean): string {
  let out = '';
  let state = State.NotStarted;
  for (let i = 0; i < name.length; i++) {
    const current = name.charAt(i);
    if (UPPER.test(current)) {
      if (
        state === State.LowercaseLetterOrDigit ||
        state === State.SpaceSeparator ||
        (state === State.UppercaseLetter && i + 1 < name.length && LOWER.test(name.charAt(i + 1)))
      ) {
        out += separator;
      }
      out += lowercase ? current.toLowerCase() : current;
      state = State.UppercaseLetter;
    } else if (LOWER.test(current) || DIGIT.test(current)) {
      if (state === State.SpaceSeparator) out += separator;
      out += !lowercase && LOWER.test(current) ? current.toUpperCase() : current;
      state = State.LowercaseLetterOrDigit;
    } else if (SPACE.test(current)) {
      if (state !== State.NotStarted) state = State.SpaceSeparator;
    } else {
      out += current;
      state = State.NotStarted;
    }
  }
  return out;
}

/** Lower-cases the leading uppercase run of a member name (camelCase wire name). */
export function toCamelCaseName(name: string): string {
  if (name === '' || !UPPER.test(name.charAt(0))) return name;
  const chars = name.split('');
  for (let i = 0; i < chars.length; i++) {
    if (i === 1 && !UPPER.test(chars[i] as string)) break;
    const hasNext = i + 1 < chars.length;
    if (i > 0 && hasNext && !UPPER.test(chars[i + 1] as string)) {
      if (chars[i + 1] === ' ') chars[i] = (chars[i] as string).toLowerCase();
      break;
    }
    chars[i] = (chars[i] as string).toLowerCase();
  }
  return chars.join('');
}

/** Converts a member name to its wire name. */
export function convertEnumName(name: string, naming: EnumNaming): string {
  switch (naming) {
    case 'snake_case_upper':
      return toSeparated(name, '_', false);
    case 'kebab-case-lower':
      return toSeparated(name, '-', true);
    case 'kebab-case-upper':
      return toSeparated(name, '-', false);
    case 'camelCase':
      return toCamelCaseName(name);
    case 'PascalCase':
      return name;
    default:
      return toSeparated(name, '_', true);
  }
}
