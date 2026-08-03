---
name: tsentials-string
description: Use when converting string casing — toPascalCase/toCamelCase/toKebabCase/toSnakeCase/toMacroCase/toTrainCase/toTitleCase/toUnderscoreCamelCase, all word-boundary aware (camelCase, PascalCase, consecutive-uppercase runs like "XMLParser", whitespace, hyphens, underscores).
---

# tsentials/string — Skill

Use when converting between naming conventions (camelCase, kebab-case, snake_case, etc.).

## API

```typescript
import {
  toPascalCase,
  toCamelCase,
  toKebabCase,
  toSnakeCase,
  toMacroCase,
  toTrainCase,
  toTitleCase,
  toUnderscoreCamelCase,
} from 'tsentials/string';

toPascalCase('hello-world');          // "HelloWorld"
toCamelCase('hello-world');           // "helloWorld"
toKebabCase('helloWorld');            // "hello-world"
toSnakeCase('helloWorld');            // "hello_world"
toMacroCase('helloWorld');            // "HELLO_WORLD"
toTrainCase('hello_world');           // "Hello-World"
toTitleCase('helloWorld');            // "Hello World"
toUnderscoreCamelCase('helloWorld');  // "_helloWorld"
```

## Patterns

- Every function accepts any input casing (camelCase, PascalCase, kebab-case, snake_case, space-separated) — word boundaries are detected automatically, so there is no need to normalize input first.
- Consecutive uppercase runs split before the trailing capitalized word: `"XMLParser"` → `["XML", "Parser"]`.
- All functions are pure and take a single `string` argument — no options object, no locale handling.
