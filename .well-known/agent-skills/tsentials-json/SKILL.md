---
name: tsentials-json
description: Use when parsing or stringifying JSON safely without exceptions — safeJsonParse/safeJsonStringify return Result<T> instead of throwing, parseAndValidate combines parsing with a custom type guard, and Json/JsonObject/JsonArray/JsonPrimitive types plus isJson/isJsonObject guards enforce structural validity at compile and runtime.
---

# tsentials/json

Type-safe JSON parsing and validation that returns `Result<T>` — no exceptions, no try/catch, fits directly into the railway pipeline.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { safeJsonParse, safeJsonStringify, parseAndValidate } from 'tsentials/json';
import { isJson, isJsonObject, isJsonArray, isJsonPrimitive } from 'tsentials/json';
import type { Json, JsonObject, JsonArray, JsonPrimitive } from 'tsentials/json';
```

---

## safeJsonParse

Parses a JSON string and returns `Result<Json>`. Never throws.

```typescript
const result = safeJsonParse('{"name":"Alice","age":30}');

if (result.ok) {
  console.log(result.value); // { name: "Alice", age: 30 }
} else {
  console.error(result.errors[0].code);
  // "Json.SyntaxError"    — malformed input
  // "Json.ValidationError" — parsed but contains undefined/functions/class instances
}
```

---

## safeJsonStringify

Stringifies a `Json` value and returns `Result<string>`. Catches circular reference errors.

```typescript
const result = safeJsonStringify({ id: 1, tags: ['a', 'b'] });

if (result.ok) {
  console.log(result.value); // '{"id":1,"tags":["a","b"]}'
} else {
  console.error(result.errors[0].code); // "Json.StringifyFailed"
}
```

---

## parseAndValidate

Parses JSON and validates with a custom type guard. Returns `Result<T>` — typed to your domain type.

```typescript
import { isJsonObject } from 'tsentials/json';

interface User { name: string; age: number }

function isUser(value: unknown): value is User {
  return isJsonObject(value) && typeof value.name === 'string' && typeof value.age === 'number';
}

const result = parseAndValidate<User>('{"name":"Alice","age":30}', isUser);

if (result.ok) {
  console.log(result.value.name); // "Alice" — fully typed as User
}
```

---

## Type Guards

```typescript
isJsonPrimitive('hello');           // true — string | number | boolean | null
isJsonPrimitive(undefined);         // false

isJsonArray([1, 'a', null]);        // true
isJsonArray({});                    // false

isJsonObject({ key: 'value' });     // true  — plain objects only
isJsonObject(new Date());           // false — rejects class instances
isJsonObject([]);                   // false — arrays are not objects

isJson({ nested: [1, null] });      // true  — recursive validation
isJson({ fn: () => {} });           // false — functions not valid JSON
isJson({ key: undefined });         // false — undefined not valid JSON
```

> **Important:** `isJsonObject` only accepts plain objects (`Object.prototype` or `null` prototype). `new Date()`, `new Map()`, class instances all return `false`.

---

## Error Codes

| Code | Cause |
|------|-------|
| `Json.SyntaxError` | `JSON.parse` threw — malformed input string |
| `Json.ValidationError` | Parsed successfully but failed `isJson` or custom guard |
| `Json.StringifyFailed` | `JSON.stringify` threw — typically a circular reference |

---

## Pipeline Integration

`safeJsonParse` returns `Result<Json>` so it chains directly into any railway pipeline:

```typescript
import { Result } from 'tsentials/result';
import { safeJsonParse, isJsonObject, parseAndValidate } from 'tsentials/json';

// Chain into Result pipeline
const processed = Result.then(
  safeJsonParse(rawInput),
  data => validatePayload(data),
);

// Full async pipeline
const response = await fromAsync(fetchRawBody(req))
  .andThen(body => safeJsonParse(body))
  .andThen(data => parseAndValidate(JSON.stringify(data), isUser))
  .map(user => enrichUser(user))
  .match(
    user => ({ status: 200, body: user }),
    errs => ({ status: 400, body: errs[0]?.description }),
  );
```

---

## Json Types

```typescript
type JsonPrimitive = string | number | boolean | null;
type JsonArray     = readonly Json[];
interface JsonObject { readonly [key: string]: Json | undefined }
type Json          = JsonPrimitive | JsonArray | JsonObject;
```

All types are **readonly** — immutability is enforced at compile time.

---

## Best Practices

- Use `safeJsonParse` instead of `JSON.parse` — eliminates uncaught `SyntaxError` exceptions
- Use `parseAndValidate` to combine parsing and domain validation in one step
- Combine with `Err.fromException` only if wrapping legacy code that throws — prefer `safeJsonParse` natively
- `isJsonObject` is the right guard to use inside `parseAndValidate` type guards — it rejects class instances that `typeof x === 'object'` would accept
- Do not use `Json` as a domain type — parse to a specific interface with `parseAndValidate` instead
