import type { Result } from '../../src/result/result.js';
import type {
  CollectionPath,
  Configure,
  ElementOf,
  PathValue,
  PropertyPath,
  RuleChain,
} from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

interface Address {
  city: string | null;
  zip?: string;
}

interface Order {
  id: number;
  note: string | null;
  address: Address | null;
  lines: readonly { sku: string; qty: number }[];
  tags?: Set<string>;
  createdAt: Date;
}

const order: Order = {
  id: 1,
  note: null,
  address: { city: 'Istanbul' },
  lines: [{ sku: 'A', qty: 1 }],
  createdAt: new Date(0),
};

type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(_value?: T): void => undefined;

describe('type-level API', () => {
  it('PropertyPath enumerates nested dotted paths', () => {
    type P = PropertyPath<Order>;
    assertType<'address.city' extends P ? true : false>();
    assertType<'address.zip' extends P ? true : false>();
    assertType<'lines' extends P ? true : false>();
    assertType<'nope' extends P ? false : true>();
    // A nullable intermediate segment adds `undefined` (the runtime yields undefined there).
    assertType<Equals<PathValue<Order, 'address.city'>, string | null | undefined>>();
    assertType<Equals<PathValue<Order, 'note'>, string | null>>();
    assertType<Equals<PathValue<Order, 'address.zip'>, string | undefined>>();
  });

  it('CollectionPath / ElementOf select iterable properties', () => {
    type C = CollectionPath<Order>;
    assertType<'lines' extends C ? true : false>();
    assertType<'tags' extends C ? true : false>();
    assertType<'id' extends C ? false : true>();
    assertType<Equals<ElementOf<Order['lines']>, { sku: string; qty: number }>>();
  });

  it('for() infers the property type and rejects invalid paths', () => {
    const result: Result<Order> = Validator.validate(order, (rules) => {
      const city: RuleChain<string | null | undefined> = rules.for('address.city');
      city.notEmpty().maxLength(50);
      rules.for('id').greaterThan(0);
      rules.for('createdAt').lessThan(new Date());
    });
    expect(result.ok).toBe(true);
    // Compile-time only (never invoked): each line below must be a type error.
    const typeErrors: Configure<Order> = (rules) => {
      // @ts-expect-error — not a property path of Order
      rules.for('nope');
      // @ts-expect-error — string builtins are unavailable on a number chain
      rules.for('id').maxLength(3);
      // @ts-expect-error — comparable builtins are unavailable on an object chain
      rules.for('address').greaterThan(1);
      // @ts-expect-error — count builtins require an iterable
      rules.for('id').minCount(1);
      // @ts-expect-error — the expected value must match the property type
      rules.for('id').equal('1');
    };
    expect(typeof typeErrors).toBe('function');
  });

  it('forEach only accepts collection paths and types the item', () => {
    Validator.validate(order, (rules) => {
      rules.forEach('lines', (lineRules, line) => {
        const sku: string = line.sku;
        lineRules
          .for('sku')
          .notEmpty()
          .maxLength(sku.length + 10);
        lineRules.for('qty').greaterThan(0);
      });
    });
    const typeErrors: Configure<Order> = (rules) => {
      rules.forEach('lines', (lineRules) => {
        // @ts-expect-error — not a property of the item
        lineRules.for('id');
      });
      // @ts-expect-error — not a collection path
      rules.forEach('id', () => undefined);
    };
    expect(typeof typeErrors).toBe('function');
  });

  it('setValidator requires a validator for the non-null property type', () => {
    Validator.validate(order, (rules) => {
      rules.for('address').setValidator({ validate: (a: Address) => ({ ok: true, value: a }) });
    });
    const typeErrors: Configure<Order> = (rules) => {
      // @ts-expect-error — validator for a different type
      rules.for('address').setValidator({ validate: (n: number) => ({ ok: true, value: n }) });
    };
    expect(typeof typeErrors).toBe('function');
  });

  it('async configure is rejected by the sync validate signature at runtime only', () => {
    // The sync `Configure<T>` returns void; TypeScript accepts async lambdas there, so the
    // runtime TypeError guard (see validator.test.ts) is the safety net.
    expect(() => Validator.validate(order, async () => undefined)).toThrow(TypeError);
  });
});
