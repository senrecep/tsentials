# Contributing to tsentials

Thank you for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/senrecep/tsentials.git
cd TypeScriptEssentials
npm install
npm run build
npm test
```

## Project Structure

```
src/           — Library source (TypeScript)
tests/         — Test files (mirrors src/ structure)
docs/          — GitHub Pages documentation site
.github/       — GitHub Actions workflows
```

## Development Workflow

### 1. Branch naming
- `feat/short-description` — new feature
- `fix/short-description` — bug fix
- `docs/short-description` — documentation only
- `chore/short-description` — tooling, deps, config

### 2. Make your changes

- All source files live in `src/`
- Each module has a corresponding test file in `tests/`
- Add tests for any new functionality

### 3. Verify your changes

```bash
npm run build      # must pass — 0 TypeScript errors
npm test           # all tests must pass
npm run check      # Biome lint + format check
```

Fix any lint issues:
```bash
npm run lint:fix   # auto-fix lint issues
npm run format     # auto-format code
```

### 4. Commit message format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(result): add flatMap utility method
fix(maybe): handle null in fromTry correctly
docs(readme): update async pipeline examples
chore(deps): upgrade vitest to v3
test(rules): add async rule engine coverage
```

### 5. Pull Request

- Keep PRs focused — one feature or fix per PR
- Update tests and make sure they pass
- Update documentation if public API changed
- Describe **what** and **why** in the PR description

## Design Principles

Before adding a new method or type, check that it:

1. **Has clear semantics** — the name unambiguously describes what it does
2. **Is pure / side-effect free** (unless it's a `tap` variant)
3. **Fits the railway pattern** — functions either succeed or return structured errors
4. **Has an async variant if relevant** — if you add `foo()`, consider whether `fooAsync()` is needed
5. **Is tested** — new methods need test coverage

## Coding Conventions

- TypeScript strict mode — `strict: true`, `exactOptionalPropertyTypes: true`
- ESM only — no CommonJS (`"type": "module"`)
- No `any` types — use generics
- No thrown exceptions from library code — return `Result.failure(...)` instead
- Errors are values — `AppError` / `Err.*` factory, not `new Error(...)`
- Functional namespace style for `Result` and `Maybe` — static methods, no class instantiation

## Reporting Issues

Please include:
- tsentials version (`npm list tsentials`)
- Node.js version (`node --version`)
- TypeScript version (`tsc --version`)
- Minimal reproduction code

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
