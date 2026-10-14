import { Err } from '../../src/errors/app-error.js';
import type { Result } from '../../src/result/result.js';
import type { RuleContext } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

interface TagsModel {
  tags: readonly (string | null)[] | null;
}

interface AddressModel {
  city: string | null;
  zipCode: string | null;
}

interface OrderModel {
  addresses: readonly AddressModel[] | null;
}

interface LineModel {
  sku: string | null;
  tags: readonly (string | null)[] | null;
}

interface InvoiceModel {
  lines: readonly LineModel[] | null;
}

interface ShipmentModel {
  destination: AddressModel | null;
}

const codes = (result: Result<unknown>): string[] =>
  result.ok ? [] : result.errors.map((e) => e.code);

const validateTags = (tags: TagsModel['tags']): Result<TagsModel> =>
  Validator.validate<TagsModel>({ tags }, (rules) => {
    rules.forEach('tags', (tagRules) => {
      tagRules.self().notEmpty();
    });
  });

describe('forEach', () => {
  it('produces indexed errors when items fail', () => {
    expect(codes(validateTags(['valid', '', 'also-valid']))).toEqual(['tags[1].NotEmpty']);
  });

  it('accumulates errors across items', () => {
    expect(codes(validateTags(['', '', '']))).toEqual([
      'tags[0].NotEmpty',
      'tags[1].NotEmpty',
      'tags[2].NotEmpty',
    ]);
  });

  it('item descriptions quote the indexed path', () => {
    const result = validateTags(['']);
    expect(result.ok ? undefined : result.errors[0]?.description).toBe(
      "'tags[0]' must not be empty.",
    );
  });

  it('passes when all items are valid', () => {
    expect(validateTags(['a', 'b', 'c']).ok).toBe(true);
  });

  it('passes when the collection is null', () => {
    expect(validateTags(null).ok).toBe(true);
  });

  it('passes when the collection is empty', () => {
    expect(validateTags([]).ok).toBe(true);
  });

  it('validates item properties with the correct path', () => {
    const model: OrderModel = {
      addresses: [
        { city: 'Istanbul', zipCode: '34000' },
        { city: '', zipCode: '99999' },
      ],
    };
    const result = Validator.validate(model, (rules) => {
      rules.forEach('addresses', (addrRules) => {
        addrRules.for('city').notEmpty();
        addrRules.for('zipCode').notEmpty();
      });
    });
    expect(codes(result)).toEqual(['addresses[1].city.NotEmpty']);
  });

  it('applies the Stop cascade per item', () => {
    const model: OrderModel = {
      addresses: [
        { city: null, zipCode: null },
        { city: 'Istanbul', zipCode: '34000' },
      ],
    };
    const result = Validator.validate(model, (rules) => {
      rules.forEach('addresses', (addrRules) => {
        addrRules.for('city').notNull().notEmpty();
      });
    });
    expect(codes(result)).toEqual(['addresses[0].city.NotNull']);
  });

  it('nested forEach produces fully qualified paths', () => {
    const model: InvoiceModel = {
      lines: [
        { sku: 'SKU-1', tags: ['valid', ''] },
        { sku: 'SKU-2', tags: ['ok'] },
      ],
    };
    const result = Validator.validate(model, (rules) => {
      rules.forEach('lines', (lineRules) => {
        lineRules.forEach('tags', (tagRules) => {
          tagRules.self().notEmpty();
        });
      });
    });
    expect(codes(result)).toEqual(['lines[0].tags[1].NotEmpty']);
  });

  it('passes the item as the second argument', () => {
    const seen: (string | null)[] = [];
    Validator.validate<TagsModel>({ tags: ['a', null] }, (rules) => {
      rules.forEach('tags', (_tagRules, tag) => {
        seen.push(tag);
      });
    });
    expect(seen).toEqual(['a', null]);
  });

  it('explicit collection + name form', () => {
    const extra = ['x', ''];
    const result = Validator.validate<TagsModel>({ tags: null }, (rules) => {
      rules.forEach(extra, 'extra', (itemRules) => {
        itemRules.self().notEmpty();
      });
    });
    expect(codes(result)).toEqual(['extra[1].NotEmpty']);
  });

  it('for(value, name) inside an item context is prefixed with the item path', () => {
    const result = Validator.validate<InvoiceModel>(
      { lines: [{ sku: 'abc', tags: null }] },
      (rules) => {
        rules.forEach('lines', (lineRules, line) => {
          lineRules.for(line.sku?.toUpperCase() ?? null, 'normalizedSku').equal('ABD');
        });
      },
    );
    expect(codes(result)).toEqual(['lines[0].normalizedSku.Equal']);
  });

  it('iterates any Iterable (Set)', () => {
    const result = Validator.validate({ ids: new Set([1, -2]) }, (rules) => {
      rules.forEach('ids', (idRules) => {
        idRules.self().greaterThan(0);
      });
    });
    expect(codes(result)).toEqual(['ids[1].GreaterThan']);
  });

  it('item context addFailure is not prefixed (model-level error)', () => {
    const result = Validator.validate<TagsModel>({ tags: ['a'] }, (rules) => {
      rules.forEach('tags', (tagRules) => {
        tagRules.addFailure('Tag.Rejected', 'Rejected.');
      });
    });
    expect(codes(result)).toEqual(['Tag.Rejected']);
  });

  it('throws a TypeError for an async callback', () => {
    expect(() =>
      Validator.validate<TagsModel>({ tags: ['a'] }, (rules) => {
        rules.forEach('tags', (async () => undefined) as unknown as () => void);
      }),
    ).toThrow(TypeError);
  });
});

describe('forEachAsync', () => {
  it('accumulates errors', async () => {
    const result = await Validator.validateAsync<TagsModel>(
      { tags: ['', 'valid', ''] },
      async (rules) => {
        await rules.forEachAsync('tags', async (tagRules) => {
          await Promise.resolve();
          tagRules.self().notEmpty();
        });
      },
    );
    expect(codes(result)).toEqual(['tags[0].NotEmpty', 'tags[2].NotEmpty']);
  });

  it('processes items sequentially in order', async () => {
    const order: string[] = [];
    await Validator.validateAsync<TagsModel>({ tags: ['a', 'b', 'c'] }, async (rules) => {
      await rules.forEachAsync('tags', async (_r, tag) => {
        order.push(`start:${tag}`);
        await new Promise((resolve) => setTimeout(resolve, tag === 'a' ? 10 : 0));
        order.push(`end:${tag}`);
      });
    });
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('explicit collection form with mustAsync inside items', async () => {
    const result = await Validator.validateAsync({ id: 1 }, async (rules) => {
      await rules.forEachAsync(['taken', 'free'], 'names', async (itemRules, name) => {
        await itemRules
          .self()
          .mustAsync(async (v) => v !== 'taken', `Name.Taken`, `'${name}' is taken.`);
      });
    });
    expect(result.ok ? [] : result.errors.map((e) => e.description)).toEqual(["'taken' is taken."]);
  });

  it('passes the run signal to the callback', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    await Validator.validateAsync<TagsModel>(
      { tags: ['a'] },
      async (rules) => {
        await rules.forEachAsync('tags', (_r, _tag, signal) => {
          received = signal;
        });
      },
      { signal: controller.signal },
    );
    expect(received).toBe(controller.signal);
  });
});

class AddressValidator extends Validator<AddressModel> {
  protected configure(rules: RuleContext<AddressModel>): void {
    rules.for('city').notEmpty();
    rules.for('zipCode').notEmpty();
  }
}

class AsyncAddressValidator extends Validator<AddressModel> {
  protected async configure(rules: RuleContext<AddressModel>): Promise<void> {
    await rules.for('city').mustAsync(async (v) => v !== '', 'City.Empty', 'City is empty.');
    rules.for('zipCode').notEmpty();
  }
}

class QuotedCustomMessageValidator extends Validator<AddressModel> {
  protected configure(rules: RuleContext<AddressModel>): void {
    rules.for('city').notEmpty("'city field' for 'city' is required.");
  }
}

class UnquotedCustomMessageValidator extends Validator<AddressModel> {
  protected configure(rules: RuleContext<AddressModel>): void {
    rules.for('city').notEmpty('Custom failure text.');
  }
}

class TypedErrorValidator extends Validator<AddressModel> {
  protected configure(rules: RuleContext<AddressModel>): void {
    rules.for('city').notEmpty(Err.conflict('city.Taken', "'city' is taken.", new Map([['k', 1]])));
  }
}

const shipment = (destination: AddressModel | null): ShipmentModel => ({ destination });

describe('setValidator (sync)', () => {
  const validate = (model: ShipmentModel, validator: Validator<AddressModel>) =>
    Validator.validate(model, (rules) => {
      rules.for('destination').setValidator(validator);
    });

  it('propagates nested errors with the parent prefix', () => {
    const result = validate(shipment({ city: '', zipCode: '34000' }), new AddressValidator());
    expect(codes(result)).toEqual(['destination.city.NotEmpty']);
  });

  it('passes when nested validation succeeds', () => {
    expect(
      validate(shipment({ city: 'Istanbul', zipCode: '34000' }), new AddressValidator()).ok,
    ).toBe(true);
  });

  it('skips when the value is null', () => {
    expect(validate(shipment(null), new AddressValidator()).ok).toBe(true);
  });

  it('skips when the chain already failed', () => {
    const result = Validator.validate(shipment(null), (rules) => {
      rules
        .for('destination')
        .must((v) => v !== null, 'Destination.Required', 'Destination is required.')
        .setValidator(new AddressValidator());
    });
    expect(codes(result)).toEqual(['Destination.Required']);
  });

  it('propagates every nested error (bypasses the Stop cascade)', () => {
    const result = validate(shipment({ city: '', zipCode: '' }), new AddressValidator());
    expect(codes(result)).toEqual(['destination.city.NotEmpty', 'destination.zipCode.NotEmpty']);
  });

  it('marks the chain failed so later rules are skipped', () => {
    const result = Validator.validate(shipment({ city: '', zipCode: '1' }), (rules) => {
      rules
        .for('destination')
        .setValidator(new AddressValidator())
        .must(() => false, 'Never', 'never');
    });
    expect(codes(result)).toEqual(['destination.city.NotEmpty']);
  });

  it('prefixes the description with the parent property name', () => {
    const result = validate(shipment({ city: '', zipCode: '34000' }), new AddressValidator());
    expect(result.ok ? undefined : result.errors[0]?.description).toBe(
      "'destination.city' must not be empty.",
    );
  });

  it('prefixes the correct quoted token when the message has other quotes', () => {
    const result = validate(
      shipment({ city: '', zipCode: '34000' }),
      new QuotedCustomMessageValidator(),
    );
    expect(codes(result)).toEqual(['destination.city.NotEmpty']);
    expect(result.ok ? undefined : result.errors[0]?.description).toBe(
      "'city field' for 'destination.city' is required.",
    );
  });

  it('leaves the description untouched when the property name is not quoted', () => {
    const result = validate(
      shipment({ city: '', zipCode: '34000' }),
      new UnquotedCustomMessageValidator(),
    );
    expect(codes(result)).toEqual(['destination.city.NotEmpty']);
    expect(result.ok ? undefined : result.errors[0]?.description).toBe('Custom failure text.');
  });

  it('preserves the nested error type and metadata', () => {
    const result = validate(shipment({ city: '', zipCode: '1' }), new TypedErrorValidator());
    const error = result.ok ? undefined : result.errors[0];
    expect(error?.code).toBe('destination.city.Taken');
    expect(error?.description).toBe("'destination.city' is taken.");
    expect(error?.type).toBe('Conflict');
    expect(error?.metadata?.get('k')).toBe(1);
  });

  it('inside forEach the prefix includes the item path', () => {
    const result = Validator.validate<OrderModel>(
      {
        addresses: [
          { city: 'a', zipCode: 'b' },
          { city: '', zipCode: 'c' },
        ],
      },
      (rules) => {
        rules.forEach('addresses', (addrRules) => {
          addrRules.self().setValidator(new AddressValidator());
        });
      },
    );
    expect(codes(result)).toEqual(['addresses[1].city.NotEmpty']);
    expect(result.ok ? undefined : result.errors[0]?.description).toBe(
      "'addresses[1].city' must not be empty.",
    );
  });
});

describe('setValidatorAsync', () => {
  const validateShipmentAsync = (model: ShipmentModel, validator: Validator<AddressModel>) =>
    Validator.validateAsync(model, async (rules) => {
      await rules.for('destination').setValidatorAsync(validator);
    });

  it('propagates nested errors', async () => {
    const result = await validateShipmentAsync(
      shipment({ city: '', zipCode: '34000' }),
      new AddressValidator(),
    );
    expect(codes(result)).toEqual(['destination.city.NotEmpty']);
  });

  it('runs async nested validators', async () => {
    const result = await validateShipmentAsync(
      shipment({ city: '', zipCode: '' }),
      new AsyncAddressValidator(),
    );
    expect(codes(result)).toEqual(['destination.City.Empty', 'destination.zipCode.NotEmpty']);
  });

  it('passes when nested validation succeeds', async () => {
    const result = await validateShipmentAsync(
      shipment({ city: 'Istanbul', zipCode: '34000' }),
      new AsyncAddressValidator(),
    );
    expect(result.ok).toBe(true);
  });

  it('skips when the value is null', async () => {
    const result = await validateShipmentAsync(shipment(null), new AddressValidator());
    expect(result.ok).toBe(true);
  });

  it('skips when the chain already failed', async () => {
    const nested = new AsyncAddressValidator();
    const spy = vi.spyOn(nested, 'validateAsync');
    const result = await Validator.validateAsync(shipment(null), async (rules) => {
      await rules.for('destination').notNull().setValidatorAsync(nested);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(codes(result)).toEqual(['destination.NotNull']);
  });

  it('forwards the run signal to the nested validator', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    class SignalProbe extends Validator<AddressModel> {
      protected configure(
        _rules: RuleContext<AddressModel>,
        _m: AddressModel,
        signal?: AbortSignal,
      ) {
        received = signal;
      }
    }
    await Validator.validateAsync(
      shipment({ city: 'a', zipCode: 'b' }),
      async (rules) => {
        await rules.for('destination').setValidatorAsync(new SignalProbe());
      },
      { signal: controller.signal },
    );
    expect(received).toBe(controller.signal);
  });

  it('supports a plain AsyncValidator object', async () => {
    const result = await Validator.validateAsync(
      shipment({ city: 'x', zipCode: 'y' }),
      async (rules) => {
        await rules.for('destination').setValidatorAsync({
          validateAsync: async (address) =>
            Validator.validate(address, (r) => {
              r.for('city').minLength(3);
            }),
        });
      },
    );
    expect(codes(result)).toEqual(['destination.city.MinLength']);
  });
});
