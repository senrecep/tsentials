import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';
import { RuleEngine } from '../../src/rules/rule-engine.js';
import type { RuleContext } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

interface UserRequest {
  name: string | null;
  email: string | null;
  age: number;
}

class UserRequestValidator extends Validator<UserRequest> {
  protected configure(rules: RuleContext<UserRequest>): void {
    rules.for('name').notEmpty();
    rules.for('email').notEmpty().emailAddress();
    rules.for('age').greaterThan(0);
  }
}

class BaseUserValidator extends Validator<UserRequest> {
  protected configure(rules: RuleContext<UserRequest>): void {
    rules.for('name').notEmpty();
    rules.for('email').notEmpty();
  }
}

class FullUserValidator extends Validator<UserRequest> {
  protected configure(rules: RuleContext<UserRequest>, model: UserRequest): void {
    this.include(new BaseUserValidator(), rules, model);
    rules.for('age').greaterThan(0);
  }
}

class AsyncBaseValidator extends Validator<UserRequest> {
  protected async configure(rules: RuleContext<UserRequest>): Promise<void> {
    await rules.for('email').mustAsync(async (v) => v !== 'taken@x.io', 'Email.Taken', 'Taken.');
  }
}

class AsyncFullValidator extends Validator<UserRequest> {
  protected async configure(
    rules: RuleContext<UserRequest>,
    model: UserRequest,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await this.include(new AsyncBaseValidator(), rules, model, signal);
    rules.for('age').greaterThan(0);
  }
}

const user = (name: string | null, email: string | null, age: number): UserRequest => ({
  name,
  email,
  age,
});

const codes = (result: Result<unknown>): string[] =>
  result.ok ? [] : result.errors.map((e) => e.code);

describe('Validator subclass', () => {
  const validator = new UserRequestValidator();

  it('returns success carrying the same instance when all rules pass', () => {
    const request = user('Alice', 'alice@example.com', 30);
    const result = validator.validate(request);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(request);
  });

  it('returns a failure when one rule fails', () => {
    expect(codes(validator.validate(user('', 'alice@example.com', 30)))).toEqual(['name.NotEmpty']);
  });

  it('returns every error in rule order', () => {
    expect(codes(validator.validate(user('', 'not-an-email', -1)))).toEqual([
      'name.NotEmpty',
      'email.EmailAddress',
      'age.GreaterThan',
    ]);
  });

  it('errors are all Validation type', () => {
    const result = validator.validate(user('', 'bad', 0));
    expect(result.ok ? [] : result.errors.map((e) => e.type)).toEqual([
      'Validation',
      'Validation',
      'Validation',
    ]);
  });

  it('throws a TypeError for a null / undefined instance', () => {
    expect(() => validator.validate(null as unknown as UserRequest)).toThrow(
      new TypeError('instance must not be null or undefined.'),
    );
    expect(() => validator.validate(undefined as unknown as UserRequest)).toThrow(TypeError);
  });

  it('validateAsync returns the same results', async () => {
    const ok = await validator.validateAsync(user('Alice', 'alice@example.com', 30));
    expect(ok.ok).toBe(true);
    const fail = await validator.validateAsync(user('', 'bad', 0));
    expect(codes(fail)).toHaveLength(3);
  });

  it('validateAsync rejects (does not throw synchronously) for a null instance', async () => {
    const promise = validator.validateAsync(null as unknown as UserRequest);
    await expect(promise).rejects.toThrow(TypeError);
  });

  it('a validator instance is reusable and keeps no state between runs', () => {
    expect(validator.validate(user('', 'a@b.co', 1)).ok).toBe(false);
    expect(validator.validate(user('x', 'a@b.co', 1)).ok).toBe(true);
  });

  it('validate() throws a TypeError when configure is async', () => {
    expect(() => new AsyncBaseValidator().validate(user('a', 'b@c.de', 1))).toThrow(
      new TypeError('configure returned a promise; use validateAsync() instead.'),
    );
  });
});

describe('Validator include', () => {
  const validator = new FullUserValidator();

  it('merges the included rules', () => {
    expect(codes(validator.validate(user('', '', -1)))).toEqual([
      'name.NotEmpty',
      'email.NotEmpty',
      'age.GreaterThan',
    ]);
  });

  it('passes when all rules pass', () => {
    expect(validator.validate(user('Alice', 'alice@example.com', 30)).ok).toBe(true);
  });

  it('reports only base errors when only the base fails', () => {
    expect(codes(validator.validate(user('', '', 30)))).toEqual([
      'name.NotEmpty',
      'email.NotEmpty',
    ]);
  });

  it('includes async validators when awaited', async () => {
    const result = await new AsyncFullValidator().validateAsync(user('a', 'taken@x.io', 0));
    expect(codes(result)).toEqual(['Email.Taken', 'age.GreaterThan']);
  });
});

describe('Validator.validate / validateAsync (inline)', () => {
  it('returns success carrying the instance', () => {
    const request = user('Alice', 'alice@example.com', 25);
    const result = Validator.validate(request, (rules) => {
      rules.for('name').notEmpty();
      rules.for('age').greaterThan(0);
    });
    expect(result.ok && result.value).toBe(request);
  });

  it('collects errors from every property', () => {
    const result = Validator.validate(user(null, null, -5), (rules) => {
      rules.for('name').notEmpty();
      rules.for('age').greaterThan(0);
    });
    expect(codes(result)).toEqual(['name.NotEmpty', 'age.GreaterThan']);
  });

  it('passes the model as the second argument', () => {
    const request = user('a', null, 1);
    let seen: UserRequest | undefined;
    Validator.validate(request, (_rules, model) => {
      seen = model;
    });
    expect(seen).toBe(request);
  });

  it('native if conditions skip / apply rules', () => {
    const configure = (rules: RuleContext<UserRequest>, model: UserRequest) => {
      if (model.name !== null) rules.for('name').emailAddress();
    };
    expect(Validator.validate(user(null, null, 0), configure).ok).toBe(true);
    expect(Validator.validate(user('not-an-email', null, 0), configure).ok).toBe(false);
  });

  it('throws a TypeError for a null instance or a missing configure', () => {
    expect(() => Validator.validate(null as unknown as UserRequest, () => undefined)).toThrow(
      TypeError,
    );
    expect(() => Validator.validate(user('a', null, 1), null as unknown as () => void)).toThrow(
      new TypeError('configure must be a function.'),
    );
  });

  it('throws a TypeError when the sync configure returns a promise', () => {
    expect(() =>
      Validator.validate(user('a', null, 1), (async () => undefined) as unknown as () => void),
    ).toThrow(new TypeError('configure returned a promise; use validateAsync() instead.'));
  });

  it('throws a TypeError when an async rule is not awaited', () => {
    expect(() =>
      Validator.validate(user('a', null, 1), (rules) => {
        void rules.for('name').mustAsync(async () => true, 'C', 'M');
      }),
    ).toThrow(/An async rule was not awaited/);
  });

  it('marks un-awaited async rule promises handled when sync validate throws', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const boom = async (): Promise<never> => {
        throw new Error('boom');
      };
      const failingRule = async (): Promise<never> => {
        throw new Error('rule boom');
      };
      expect(() =>
        Validator.validate(user('a', null, 1), (rules) => {
          void rules.for('name').mustAsync(boom, 'C', 'M');
        }),
      ).toThrow(/An async rule was not awaited/);
      expect(() =>
        Validator.validate(user('a', null, 1), (rules) => {
          void rules.satisfiesAsync(failingRule);
        }),
      ).toThrow(/An async rule was not awaited/);
      expect(() =>
        Validator.validate(user('a', null, 1), (rules) => {
          void rules.for('name').satisfiesAsync(failingRule);
        }),
      ).toThrow(/An async rule was not awaited/);
      expect(() =>
        Validator.validate(user('a', null, 1), (rules) => {
          void rules.forEachAsync([1], 'items', async () => {
            throw new Error('item boom');
          });
        }),
      ).toThrow(/An async rule was not awaited/);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('validateAsync rejects when an async rule is not awaited', async () => {
    await expect(
      Validator.validateAsync(user('a', null, 1), (rules) => {
        void rules.for('name').mustAsync(async () => true, 'C', 'M');
      }),
    ).rejects.toThrow(/An async rule was not awaited/);
  });

  it('validateAsync accepts a sync configure', async () => {
    const result = await Validator.validateAsync(user('', null, 1), (rules) => {
      rules.for('name').notEmpty();
    });
    expect(codes(result)).toEqual(['name.NotEmpty']);
  });

  it('validateAsync rejects with a throwing configure error', async () => {
    const boom = new Error('boom');
    await expect(
      Validator.validateAsync(user('a', null, 1), () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('model-level addFailure and satisfies (Rule<T>)', () => {
    const adult = RuleEngine.fromPredicate<UserRequest>(
      (u) => u.age >= 18,
      Err.validation('User.Minor', 'Must be 18+'),
    );
    const result = Validator.validate(user('a', 'b', 10), (rules, model) => {
      if (model.name === model.email) rules.addFailure('User.Same', 'Same.');
      rules.satisfies(adult);
    });
    expect(codes(result)).toEqual(['User.Minor']);
  });

  it('context satisfiesAsync forwards the signal', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const result = await Validator.validateAsync(
      user('a', 'b', 10),
      async (rules) => {
        await rules.satisfiesAsync(async (_u, signal) => {
          received = signal;
          return Result.failure(Err.validation('Async.Fail', 'Async fail.'));
        });
      },
      { signal: controller.signal },
    );
    expect(received).toBe(controller.signal);
    expect(codes(result)).toEqual(['Async.Fail']);
  });

  it('exposes the run signal on the context', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await Validator.validateAsync(
      user('a', 'b', 1),
      (rules, _m, signal) => {
        seen = rules.signal;
        expect(signal).toBe(controller.signal);
      },
      { signal: controller.signal },
    );
    expect(seen).toBe(controller.signal);
  });

  it('self() on the root context throws a TypeError', () => {
    expect(() =>
      Validator.validate(user('a', 'b', 1), (rules) => {
        rules.self();
      }),
    ).toThrow(new TypeError('self() is only available on forEach item contexts.'));
  });
});

describe('Validator.validateWith', () => {
  const preError = Err.validation('Pre.Error', 'Pre-existing error.');
  const validator = new UserRequestValidator();

  it('passes a failure through without running the delegate', () => {
    const configure = vi.fn();
    const result = Validator.validateWith(Result.failure<UserRequest>(preError), configure);
    expect(configure).not.toHaveBeenCalled();
    expect(result.ok ? [] : result.errors).toEqual([preError]);
  });

  it('validates a success with a delegate', () => {
    const model = user('Alice', 'a@b.co', 30);
    const ok = Validator.validateWith(Result.success(model), (rules) => {
      rules.for('name').notEmpty();
    });
    expect(ok.ok && ok.value).toBe(model);
    const fail = Validator.validateWith(Result.success(user('', null, 1)), (rules) => {
      rules.for('name').notEmpty();
    });
    expect(codes(fail)).toEqual(['name.NotEmpty']);
  });

  it('validates a success with a validator', () => {
    expect(codes(Validator.validateWith(Result.success(user('', 'x', -5)), validator))).toEqual([
      'name.NotEmpty',
      'email.EmailAddress',
      'age.GreaterThan',
    ]);
  });

  it('composes in Result.then pipelines', () => {
    const result = Result.then(Result.success(user('Alice', 'a@b.co', 30)), (u) =>
      Validator.validateWith(Result.success(u), validator),
    );
    expect(result.ok).toBe(true);
  });

  it('throws a TypeError for a null validator', () => {
    expect(() =>
      Validator.validateWith(
        Result.success(user('a', null, 1)),
        null as unknown as UserRequestValidator,
      ),
    ).toThrow(new TypeError('validator must not be null or undefined.'));
  });
});

describe('Validator.validateWithAsync', () => {
  const preError = Err.validation('Pre.Error', 'Pre-existing error.');
  const validator = new UserRequestValidator();

  it('passes a failure through (validator)', async () => {
    const spy = vi.spyOn(validator, 'validateAsync');
    const result = await Validator.validateWithAsync(
      Result.failure<UserRequest>(preError),
      validator,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok ? [] : result.errors).toEqual([preError]);
    spy.mockRestore();
  });

  it('validates a success with a validator', async () => {
    const model = user('Alice', 'a@b.co', 30);
    const ok = await Validator.validateWithAsync(Result.success(model), validator);
    expect(ok.ok && ok.value).toBe(model);
    const fail = await Validator.validateWithAsync(
      Result.success(user('', 'a@b.co', -5)),
      validator,
    );
    expect(codes(fail)).toEqual(['name.NotEmpty', 'age.GreaterThan']);
  });

  it('accepts sync and async delegates', async () => {
    const syncCalled = vi.fn();
    const skipped = await Validator.validateWithAsync(
      Result.failure<UserRequest>(preError),
      syncCalled,
    );
    expect(syncCalled).not.toHaveBeenCalled();
    expect(skipped.ok).toBe(false);

    const asyncResult = await Validator.validateWithAsync(
      Result.success(user('', null, 1)),
      async (rules) => {
        await rules.for('name').mustAsync(async (v) => v !== '', 'Name.Empty', 'Empty.');
      },
    );
    expect(codes(asyncResult)).toEqual(['Name.Empty']);
  });

  it('accepts a promise of a result', async () => {
    const model = user('Alice', 'a@b.co', 30);
    const ok = await Validator.validateWithAsync(Promise.resolve(Result.success(model)), validator);
    expect(ok.ok && ok.value).toBe(model);
    const passthrough = await Validator.validateWithAsync(
      Promise.resolve(Result.failure<UserRequest>(preError)),
      validator,
    );
    expect(passthrough.ok ? [] : passthrough.errors).toEqual([preError]);
  });

  it('rejects with the signal reason when aborted while awaiting the source promise', async () => {
    const controller = new AbortController();
    const reason = new Error('stop');
    const never = new Promise<Result<UserRequest>>(() => undefined);
    const promise = Validator.validateWithAsync(never, validator, { signal: controller.signal });
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });

  it('promise source with sync / async delegates: passthrough and success', async () => {
    const model = user('Alice', 'a@b.co', 30);
    const syncDelegate = vi.fn((rules: RuleContext<UserRequest>) => {
      rules.for('name').notEmpty();
    });
    const asyncDelegate = vi.fn(async (rules: RuleContext<UserRequest>) => {
      await rules.for('name').mustAsync(async (v) => v !== '', 'Name.Empty', 'Empty.');
    });
    for (const delegate of [syncDelegate, asyncDelegate]) {
      const skipped = await Validator.validateWithAsync(
        Promise.resolve(Result.failure<UserRequest>(preError)),
        delegate,
      );
      expect(skipped.ok ? [] : skipped.errors).toEqual([preError]);
      expect(delegate).not.toHaveBeenCalled();
      const ok = await Validator.validateWithAsync(
        Promise.resolve(Result.success(model)),
        delegate,
      );
      expect(ok.ok && ok.value).toBe(model);
      expect(delegate).toHaveBeenCalledTimes(1);
    }
  });

  it('aborting while awaiting the source never calls the delegate', async () => {
    const controller = new AbortController();
    const reason = new Error('stop');
    const delegate = vi.fn();
    const never = new Promise<Result<UserRequest>>(() => undefined);
    const promise = Validator.validateWithAsync(never, delegate, { signal: controller.signal });
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
    expect(delegate).not.toHaveBeenCalled();
  });

  it('rejects with a TypeError for a null validator', async () => {
    await expect(
      Validator.validateWithAsync(
        Result.success(user('a', null, 1)),
        null as unknown as UserRequestValidator,
      ),
    ).rejects.toThrow(TypeError);
  });
});

describe('toRule / toAsyncRule (RuleEngine integration)', () => {
  const validator = new UserRequestValidator();

  it('a validator rule composes with RuleEngine.andAll', () => {
    const notBob = RuleEngine.fromPredicate<UserRequest>(
      (u) => u.name !== 'Bob',
      Err.validation('User.Bob', 'No Bobs.'),
    );
    const rule = RuleEngine.andAll(validator.toRule(), notBob);
    const result = RuleEngine.evaluate(rule, user('Bob', 'x', 0));
    expect(codes(result)).toEqual(['email.EmailAddress', 'age.GreaterThan', 'User.Bob']);
    expect(RuleEngine.evaluate(rule, user('Al', 'a@b.co', 1)).ok).toBe(true);
  });

  it('static toRule wraps inline rules', () => {
    const rule = Validator.toRule<UserRequest>((rules) => {
      rules.for('age').inclusiveBetween(18, 65);
    });
    expect(codes(rule(user('a', 'b', 70)))).toEqual(['age.InclusiveBetween']);
    expect(rule(user('a', 'b', 30)).ok).toBe(true);
  });

  it('toAsyncRule composes with RuleEngine.andAllAsync and forwards the signal', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const probe = Validator.toAsyncRule<UserRequest>(async (rules, _m, signal) => {
      received = signal;
      await rules.for('name').mustAsync(async (v) => v !== 'x', 'Name.X', 'X.');
    });
    const rule = RuleEngine.andAllAsync(new AsyncFullValidator().toAsyncRule(), probe);
    const result = await RuleEngine.evaluateAsync(rule, user('x', 'taken@x.io', 0), {
      signal: controller.signal,
    });
    expect(received).toBe(controller.signal);
    expect(codes(result)).toEqual(['Email.Taken', 'age.GreaterThan', 'Name.X']);
  });

  it('toAsyncRule falls back to the options signal', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const rule = Validator.toAsyncRule<UserRequest>(
      (_rules, _m, signal) => {
        received = signal;
      },
      { signal: controller.signal },
    );
    expect((await rule(user('a', 'b', 1))).ok).toBe(true);
    expect(received).toBe(controller.signal);
  });

  it('toRule results are void (no value)', () => {
    const result = validator.toRule()(user('Al', 'a@b.co', 1));
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : 'x').toBeUndefined();
  });
});

describe('Validator#toAsyncRule options signal', () => {
  it('uses the options signal when the rule is called without one', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    class SignalProbe extends Validator<{ id: number }> {
      protected configure(
        _rules: RuleContext<{ id: number }>,
        _model: { id: number },
        signal?: AbortSignal,
      ): void {
        received = signal;
      }
    }
    const rule = new SignalProbe().toAsyncRule({ signal: controller.signal });
    expect((await rule({ id: 1 })).ok).toBe(true);
    expect(received).toBe(controller.signal);
  });
});
