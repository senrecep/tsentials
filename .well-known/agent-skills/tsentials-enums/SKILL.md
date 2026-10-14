---
name: tsentials-enums
description: Use when you need enums with wire names, aliases and safe parsing — defineEnum() declares members with explicit or derived wire names, numeric values, aliases and an optional fallback member; parse/parseNumber return Result<T> instead of throwing, format converts back to wire text or number.
---

# tsentials/enums

Enum definitions with wire names, aliases, a fallback member and Result-returning parsing. **Subpath-only:** not exported from the root `tsentials` entry.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { defineEnum } from 'tsentials/enums';
import type { EnumMember, EnumDefinition, EnumParseOptions, EnumNaming } from 'tsentials/enums';
```

---

## Define

```typescript
const Status = defineEnum('Status', {
  Pending: {},                       // wire name 'pending' (default naming snake_case_lower), value 0
  Active: 'on',                      // string = explicit wire name, value 1
  Disabled: { aliases: ['off'] },    // extra accepted input, value 2
  Unknown: { fallback: true },       // used in data mode for unknown input
});
type Status = EnumMember<typeof Status>;   // 'Pending' | 'Active' | 'Disabled' | 'Unknown'
```

Member options: `wire`, `value` (int32; later members continue from it), `aliases`, `fallback`, `description`, `obsolete`. Third argument: `{ naming }` — `'snake_case_lower'` (default), `'snake_case_upper'`, `'kebab-case-lower'`, `'kebab-case-upper'`, `'camelCase'`, `'PascalCase'`.

## Parse

```typescript
Status.parse('on');                       // success('Active'); also 'ACTIVE', 'Active' (case-insensitive)
Status.parse('off');                      // success('Disabled') via alias
Status.parse('2');                        // success('Disabled') — numeric text accepted
Status.parse('nope');                     // failure 'Enum.InvalidValue' (Validation, lists allowed values)
Status.parse('nope', { mode: 'data' });   // success('Unknown') — data mode uses the fallback member
Status.parse('x', { path: 'status' });    // path is included in the error
Status.parseNumber(1);                    // success('Active')
```

`EnumParseOptions`: `mode` (`'input'` default | `'data'`), `path`, `acceptNumbers`, `acceptMemberNames`, `caseInsensitive`, `unknownValue` (`'useFallback' | 'reject'`).

## Format and inspect

```typescript
Status.format('Active');            // 'on'
Status.format('Active', 'number');  // '1'
Status.numberOf('Disabled');        // 2
Status.is('Active');                // type guard: value is Status
Status.keys;                        // member names
Status.wireNames;                   // wire names
Status.members;                     // EnumMemberInfo[] (name, wireName, value, aliases, ...)
Status.infoOf('Active');
```

---

## Patterns and pitfalls

- Import from `tsentials/enums` — never from the root `tsentials` entry.
- `defineEnum` throws (programmer error): empty member list, more than one fallback, duplicate wire names or aliases, non-int32 values.
- `parse` never throws; invalid text is a `Validation` failure `Enum.InvalidValue`. Use `{ mode: 'data' }` only for trusted persisted data where an unknown value should degrade to the fallback.
- Declare `type Status = EnumMember<typeof Status>` next to the const so one name serves as both value and type.
- Combine with `tsentials/validation` (`isDefinedEnum`) or `Result.then` for request validation.
