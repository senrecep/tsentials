import type { Json, JsonArray, JsonObject, JsonPrimitive } from './json-types.js';

/**
 * A type guard to safely determine if an unknown value is a `JsonPrimitive`.
 */
export function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  const type = typeof value;
  return value === null || type === 'string' || type === 'number' || type === 'boolean';
}

/**
 * A type guard to safely determine if an unknown value is a `JsonArray`.
 */
export function isJsonArray(value: unknown): value is JsonArray {
  return Array.isArray(value);
}

/**
 * A type guard to safely determine if an unknown value is a "plain" `JsonObject`.
 *
 * @remarks
 * Returns `false` for complex object types like `new Date()`, `new RegExp()`, or class instances.
 * Only accepts objects whose prototype is `Object.prototype` or `null`.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * A comprehensive, recursive type guard to validate if an unknown value
 * conforms to the `Json` type.
 *
 * @remarks
 * Be mindful of performance on very large or deeply nested structures.
 */
export function isJson(value: unknown): value is Json {
  if (isJsonPrimitive(value)) return true;

  if (isJsonArray(value)) {
    return value.every(isJson);
  }

  if (isJsonObject(value)) {
    return Object.values(value).every(isJson);
  }

  return false;
}
