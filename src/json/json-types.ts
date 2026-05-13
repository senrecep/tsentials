/**
 * Represents the primitive value types allowed in JSON.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Represents a read-only JSON array, ensuring immutability.
 */
export type JsonArray = readonly Json[];

/**
 * Represents a read-only JSON object, a dictionary with string keys and JSON values,
 * ensuring immutability.
 *
 * @remarks
 * While 'undefined' is not a valid JSON value, accessing a non-existent key
 * on an object in TypeScript returns 'undefined'. This type definition
 * reflects that, but guards like 'isJson' will not permit 'undefined' values.
 */
export interface JsonObject {
  readonly [key: string]: Json | undefined;
}

/**
 * Represents any valid, immutable JSON value.
 * This is a recursive type that covers all possible JSON structures.
 */
export type Json = JsonPrimitive | JsonArray | JsonObject;
