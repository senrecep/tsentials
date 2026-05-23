import { isJson, isJsonArray, isJsonObject, isJsonPrimitive } from '../../src/json/json-guards.js';
import { parseAndValidate, safeJsonParse, safeJsonStringify } from '../../src/json/json-utils.js';
import { Result } from '../../src/result/result.js';

// ─── Type Guards ──────────────────────────────────────────────────────────────

describe('isJsonPrimitive', () => {
  it('accepts string', () => expect(isJsonPrimitive('hello')).toBe(true));
  it('accepts number', () => expect(isJsonPrimitive(42)).toBe(true));
  it('accepts boolean', () => expect(isJsonPrimitive(true)).toBe(true));
  it('accepts null', () => expect(isJsonPrimitive(null)).toBe(true));
  it('rejects undefined', () => expect(isJsonPrimitive(undefined)).toBe(false));
  it('rejects object', () => expect(isJsonPrimitive({})).toBe(false));
  it('rejects array', () => expect(isJsonPrimitive([])).toBe(false));
});

describe('isJsonArray', () => {
  it('accepts empty array', () => expect(isJsonArray([])).toBe(true));
  it('accepts array of primitives', () => expect(isJsonArray([1, 'a', true, null])).toBe(true));
  it('rejects object', () => expect(isJsonArray({})).toBe(false));
  it('rejects null', () => expect(isJsonArray(null)).toBe(false));
  it('rejects string', () => expect(isJsonArray('[]')).toBe(false));
});

describe('isJsonObject', () => {
  it('accepts plain object', () => expect(isJsonObject({ a: 1 })).toBe(true));
  it('accepts null-prototype object', () => expect(isJsonObject(Object.create(null))).toBe(true));
  it('rejects array', () => expect(isJsonObject([])).toBe(false));
  it('rejects null', () => expect(isJsonObject(null)).toBe(false));
  it('rejects class instance', () => expect(isJsonObject(new Date())).toBe(false));
  it('rejects RegExp', () => expect(isJsonObject(/regex/)).toBe(false));
});

describe('isJson', () => {
  it('accepts primitive', () => expect(isJson(42)).toBe(true));
  it('accepts nested object', () => expect(isJson({ a: { b: [1, 2, null] } })).toBe(true));
  it('accepts deeply nested array', () => expect(isJson([{ x: true }, [1, 'two']])).toBe(true));
  it('rejects undefined', () => expect(isJson(undefined)).toBe(false));
  it('rejects object with function value', () => expect(isJson({ fn: () => {} })).toBe(false));
  it('rejects object with undefined value', () => expect(isJson({ key: undefined })).toBe(false));
  it('rejects Date instance', () => expect(isJson(new Date())).toBe(false));
});

// ─── safeJsonParse ────────────────────────────────────────────────────────────

describe('safeJsonParse', () => {
  it('parses valid JSON string', () => {
    const result = safeJsonParse('"hello"');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello');
  });

  it('parses valid JSON object', () => {
    const result = safeJsonParse('{"key":"value","num":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ key: 'value', num: 1 });
  });

  it('parses valid JSON array', () => {
    const result = safeJsonParse('[1,2,3]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([1, 2, 3]);
  });

  it('fails on malformed JSON with SyntaxError code', () => {
    const result = safeJsonParse('{invalid}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('Json.SyntaxError');
    }
  });

  it('fails on empty string', () => {
    const result = safeJsonParse('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('Json.SyntaxError');
  });
});

// ─── safeJsonStringify ────────────────────────────────────────────────────────

describe('safeJsonStringify', () => {
  it('stringifies a plain object', () => {
    const result = safeJsonStringify({ a: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('{"a":1}');
  });

  it('stringifies null', () => {
    const result = safeJsonStringify(null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('null');
  });

  it('stringifies a string primitive', () => {
    const result = safeJsonStringify('hello');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('"hello"');
  });

  it('stringifies an array', () => {
    const result = safeJsonStringify([1, true, null]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('[1,true,null]');
  });
});

// ─── parseAndValidate ─────────────────────────────────────────────────────────

interface User {
  name: string;
  age: number;
}

function isUser(value: unknown): value is User {
  return isJsonObject(value) && typeof value.name === 'string' && typeof value.age === 'number';
}

describe('parseAndValidate', () => {
  it('returns typed value on success', () => {
    const result = parseAndValidate<User>('{"name":"Alice","age":30}', isUser);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Alice');
      expect(result.value.age).toBe(30);
    }
  });

  it('fails with SyntaxError on malformed JSON', () => {
    const result = parseAndValidate<User>('{bad}', isUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('Json.SyntaxError');
  });

  it('fails with TypeValidationError when guard returns false', () => {
    const result = parseAndValidate<User>('{"name":"Alice"}', isUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('Json.TypeValidationError');
  });

  it('fails with TypeValidationError for wrong types', () => {
    const result = parseAndValidate<User>('{"name":123,"age":"old"}', isUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('Json.TypeValidationError');
  });

  it('parseAndValidate failure uses TypeValidationError code distinct from parse error', () => {
    const isNumber = (v: unknown): v is number => typeof v === 'number';
    const parseError = safeJsonParse('invalid json');
    const validateError = parseAndValidate<number>('"not-a-number"', isNumber);

    expect(Result.isFailure(parseError)).toBe(true);
    expect(Result.isFailure(validateError)).toBe(true);
    expect(Result.firstError(parseError)?.code).toBe('Json.SyntaxError');
    expect(Result.firstError(validateError)?.code).toBe('Json.TypeValidationError');
  });
});
