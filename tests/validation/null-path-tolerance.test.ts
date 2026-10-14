import { Validator } from '../../src/validation/index.js';

interface InnerModel {
  text: string | null;
  number: number;
  tags: string[] | null;
}

interface OuterModel {
  inner: InnerModel | null;
}

const codes = (result: { ok: boolean; errors?: readonly { code: string }[] }): string[] =>
  result.ok ? [] : (result.errors ?? []).map((e) => e.code);

describe('null path tolerance', () => {
  it('a null intermediate segment is treated as a null value', () => {
    const result = Validator.validate<OuterModel>({ inner: null }, (rules) => {
      rules.for('inner.text').notEmpty();
    });
    expect(codes(result)).toEqual(['inner.text.NotEmpty']);
  });

  it('an undefined intermediate segment is treated as a null value', () => {
    const model = { inner: undefined } as unknown as OuterModel;
    const result = Validator.validate(model, (rules) => {
      rules.for('inner.text').notNull();
    });
    expect(codes(result)).toEqual(['inner.text.NotNull']);
  });

  it('null-skipping validators pass when an intermediate segment is null', () => {
    const result = Validator.validate<OuterModel>({ inner: null }, (rules) => {
      rules.for('inner.text').maxLength(5).emailAddress();
    });
    expect(result.ok).toBe(true);
  });

  it('a fully populated path evaluates normally', () => {
    const result = Validator.validate<OuterModel>(
      { inner: { text: 'hello', number: 42, tags: null } },
      (rules) => {
        rules.for('inner.text').notEmpty().maxLength(3);
      },
    );
    expect(codes(result)).toEqual(['inner.text.MaxLength']);
  });

  it('non-nullable leaves under a null segment are also tolerated (no throw)', () => {
    const result = Validator.validate<OuterModel>({ inner: null }, (rules) => {
      rules.for('inner.number').greaterThan(0);
    });
    expect(result.ok).toBe(true);
  });

  it('forEach produces no errors when the collection path has a null segment', () => {
    const result = Validator.validate<OuterModel>({ inner: null }, (rules) => {
      rules.forEach('inner.tags', (tagRules) => {
        tagRules.self().notEmpty();
      });
    });
    expect(result.ok).toBe(true);
  });

  it('forEachAsync produces no errors when the collection path has a null segment', async () => {
    const result = await Validator.validateAsync<OuterModel>({ inner: null }, async (rules) => {
      await rules.forEachAsync('inner.tags', (tagRules) => {
        tagRules.self().notEmpty();
      });
    });
    expect(result.ok).toBe(true);
  });

  it('forEach iterates normally when the path is populated', () => {
    const result = Validator.validate<OuterModel>(
      { inner: { text: null, number: 0, tags: ['ok', ''] } },
      (rules) => {
        rules.forEach('inner.tags', (tagRules) => {
          tagRules.self().notEmpty();
        });
      },
    );
    expect(codes(result)).toEqual(['inner.tags[1].NotEmpty']);
  });
});
