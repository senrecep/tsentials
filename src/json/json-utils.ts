import { Err } from '../errors/app-error.js';
import type { Result } from '../result/result.js';
import { Result as R } from '../result/result.js';
import { isJson } from './json-guards.js';
import type { Json } from './json-types.js';

/**
 * Safely parses a JSON string and validates its structure against the `Json` type.
 *
 * @example
 * const result = safeJsonParse('{"key": "value"}');
 * if (result.ok) {
 *   console.log(result.value); // { key: "value" }
 * } else {
 *   console.error(result.errors[0].code); // "Json.SyntaxError" | "Json.ValidationError"
 * }
 */
export function safeJsonParse(jsonString: string): Result<Json> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'JSON syntax error';
    return R.failure(Err.validation('Json.SyntaxError', msg));
  }

  if (isJson(parsed)) {
    return R.success(parsed);
  }

  return R.failure(
    Err.validation(
      'Json.ValidationError',
      "Parsed object is not valid JSON. It may contain functions, 'undefined', or non-plain objects.",
    ),
  );
}

/**
 * Safely stringifies a `Json` value into a JSON string.
 * Catches potential errors from `JSON.stringify`, such as circular references.
 */
export function safeJsonStringify(value: Json): Result<string> {
  try {
    return R.success(JSON.stringify(value));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to stringify JSON value.';
    return R.failure(Err.unexpected('Json.StringifyFailed', msg));
  }
}

/**
 * Parses a JSON string and validates it against a custom type guard.
 *
 * @example
 * interface User { name: string; id: number }
 * function isUser(value: unknown): value is User {
 *   return isJsonObject(value) &&
 *     typeof value['name'] === 'string' &&
 *     typeof value['id'] === 'number';
 * }
 * const result = parseAndValidate<User>(jsonString, isUser);
 * if (result.ok) {
 *   console.log(result.value.name); // Type-safe!
 * }
 */
export function parseAndValidate<T>(
  jsonString: string,
  guard: (value: unknown) => value is T,
): Result<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'JSON syntax error';
    return R.failure(Err.validation('Json.SyntaxError', msg));
  }

  if (guard(parsed)) {
    return R.success(parsed);
  }

  return R.failure(
    Err.validation(
      'Json.TypeValidationError',
      'Parsed object failed custom type guard validation.',
    ),
  );
}
