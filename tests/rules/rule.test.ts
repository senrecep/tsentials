import type { Rule, AsyncRule, TypedRule, TypedAsyncRule } from '../../src/rules/rule.js';
import { Result } from '../../src/result/result.js';
import { Err } from '../../src/errors/app-error.js';

describe('Rule types runtime behavior', () => {
  const ctx = { value: 10 };

  describe('Rule (VoidRule)', () => {
    it('returns success when predicate passes', () => {
      const rule: Rule<{ value: number }> = (c) =>
        c.value > 5 ? Result.ok() : Result.failure(Err.validation('Test', 'too small'));
      const result = rule(ctx);
      expect(result.ok).toBe(true);
    });

    it('returns failure when predicate fails', () => {
      const rule: Rule<{ value: number }> = (c) =>
        c.value > 20 ? Result.ok() : Result.failure(Err.validation('Test', 'too small'));
      const result = rule(ctx);
      expect(result.ok).toBe(false);
    });

    it('can be used as a function reference', () => {
      const rules: Rule<{ value: number }>[] = [
        (c) => (c.value > 5 ? Result.ok() : Result.failure(Err.validation('A', 'A'))),
        (c) => (c.value < 20 ? Result.ok() : Result.failure(Err.validation('B', 'B'))),
      ];
      for (const rule of rules) {
        expect(rule(ctx).ok).toBe(true);
      }
    });

    it('works with empty context (void-like)', () => {
      const rule: Rule<void> = () => Result.ok();
      expect(rule().ok).toBe(true);
    });
  });

  describe('AsyncRule', () => {
    it('returns success when async predicate passes', async () => {
      const rule: AsyncRule<{ value: number }> = async (c) =>
        c.value > 5 ? Result.ok() : Result.failure(Err.validation('Test', 'too small'));
      const result = await rule(ctx);
      expect(result.ok).toBe(true);
    });

    it('returns failure when async predicate fails', async () => {
      const rule: AsyncRule<{ value: number }> = async (c) =>
        c.value > 20 ? Result.ok() : Result.failure(Err.validation('Test', 'too small'));
      const result = await rule(ctx);
      expect(result.ok).toBe(false);
    });

    it('can be awaited in parallel', async () => {
      const rules: AsyncRule<{ value: number }>[] = [
        async (c) => (c.value > 5 ? Result.ok() : Result.failure(Err.validation('A', 'A'))),
        async (c) => (c.value < 20 ? Result.ok() : Result.failure(Err.validation('B', 'B'))),
      ];
      const results = await Promise.all(rules.map((r) => r(ctx)));
      expect(results.every((r) => r.ok)).toBe(true);
    });
  });

  describe('TypedRule', () => {
    it('returns typed success value', () => {
      const rule: TypedRule<{ value: number }, string> = (c) =>
        c.value > 5 ? Result.success('valid') : Result.failure(Err.validation('Test', 'too small'));
      const result = rule(ctx);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('valid');
    });

    it('returns failure with correct type', () => {
      const rule: TypedRule<{ value: number }, string> = (c) =>
        c.value > 20 ? Result.success('valid') : Result.failure(Err.validation('Test', 'too small'));
      const result = rule(ctx);
      expect(result.ok).toBe(false);
    });

    it('can transform context into different type', () => {
      const rule: TypedRule<{ a: number; b: number }, number> = (c) =>
        Result.success(c.a + c.b);
      const result = rule({ a: 3, b: 4 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(7);
    });
  });

  describe('TypedAsyncRule', () => {
    it('returns typed async success value', async () => {
      const rule: TypedAsyncRule<{ value: number }, string> = async (c) =>
        c.value > 5 ? Result.success('valid') : Result.failure(Err.validation('Test', 'too small'));
      const result = await rule(ctx);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('valid');
    });

    it('returns async failure with correct type', async () => {
      const rule: TypedAsyncRule<{ value: number }, string> = async (c) =>
        c.value > 20 ? Result.success('valid') : Result.failure(Err.validation('Test', 'too small'));
      const result = await rule(ctx);
      expect(result.ok).toBe(false);
    });

    it('can perform async transformation', async () => {
      const rule: TypedAsyncRule<string, number> = async (input) => {
        const parsed = Number.parseInt(input, 10);
        if (Number.isNaN(parsed)) return Result.failure(Err.validation('Parse', 'Invalid number'));
        return Result.success(parsed);
      };
      const result = await rule('42');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(42);
    });
  });

  describe('Rule composition compatibility', () => {
    it('Rule can be composed manually like RuleEngine.linear', () => {
      const r1: Rule<{ value: number }> = (c) =>
        c.value > 0 ? Result.ok() : Result.failure(Err.validation('A', 'must be positive'));
      const r2: Rule<{ value: number }> = (c) =>
        c.value < 100 ? Result.ok() : Result.failure(Err.validation('B', 'must be < 100'));

      const composed: Rule<{ value: number }> = (c) => {
        const result1 = r1(c);
        if (!result1.ok) return result1;
        return r2(c);
      };

      expect(composed({ value: 50 }).ok).toBe(true);
      expect(composed({ value: -1 }).ok).toBe(false);
      expect(composed({ value: 101 }).ok).toBe(false);
    });

    it('AsyncRule can be composed manually', async () => {
      const r1: AsyncRule<{ value: number }> = async (c) =>
        c.value > 0 ? Result.ok() : Result.failure(Err.validation('A', 'must be positive'));
      const r2: AsyncRule<{ value: number }> = async (c) =>
        c.value < 100 ? Result.ok() : Result.failure(Err.validation('B', 'must be < 100'));

      const composed: AsyncRule<{ value: number }> = async (c) => {
        const result1 = await r1(c);
        if (!result1.ok) return result1;
        return r2(c);
      };

      expect((await composed({ value: 50 })).ok).toBe(true);
      expect((await composed({ value: -1 })).ok).toBe(false);
      expect((await composed({ value: 101 })).ok).toBe(false);
    });

    it('Rule can be converted to TypedRule by returning a dummy success', () => {
      const voidRule: Rule<string> = (s) =>
        s.length > 0 ? Result.ok() : Result.failure(Err.validation('Empty', 'Empty string'));
      const typedRule: TypedRule<string, boolean> = (s) => {
        const voidResult = voidRule(s);
        if (!voidResult.ok) return Result.failureFrom(voidResult.errors);
        return Result.success(true);
      };

      const result = typedRule('hello');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });
  });
});
