import type { Cloneable } from '../../src/clone/cloneable.js';
import { cloneArray, deepClone } from '../../src/clone/cloneable.js';

class Product implements Cloneable<Product> {
  constructor(
    public readonly id: string,
    public readonly name: string,
    private _stock: number,
  ) {}

  get stock(): number { return this._stock; }

  adjustStock(delta: number): void { this._stock += delta; }

  clone(): Product {
    return new Product(this.id, this.name, this._stock);
  }
}

describe('Cloneable interface', () => {
  it('clones a Product', () => {
    const original = new Product('p1', 'Widget', 100);
    const copy = original.clone();
    expect(copy.id).toBe(original.id);
    expect(copy.name).toBe(original.name);
    expect(copy.stock).toBe(original.stock);
    expect(copy).not.toBe(original);
  });

  it('clone is independent (mutations do not affect original)', () => {
    const original = new Product('p1', 'Widget', 100);
    const copy = original.clone();
    copy.adjustStock(-10);
    expect(original.stock).toBe(100);
    expect(copy.stock).toBe(90);
  });
});

describe('cloneArray', () => {
  it('clones each element in the array', () => {
    const items = [
      new Product('a', 'Alpha', 10),
      new Product('b', 'Beta', 20),
    ];
    const cloned = cloneArray(items);
    expect(cloned).toHaveLength(2);
    expect(cloned[0]).not.toBe(items[0]);
    expect(cloned[1]).not.toBe(items[1]);
  });

  it('modifications to clone do not affect original array', () => {
    const items = [new Product('a', 'Alpha', 10)];
    const cloned = cloneArray(items);
    cloned[0]!.adjustStock(50);
    expect(items[0]!.stock).toBe(10);
  });
});

describe('deepClone', () => {
  it('deep clones a plain object', () => {
    const obj = { a: 1, nested: { b: 2 } };
    const copy = deepClone(obj);
    expect(copy).toEqual(obj);
    expect(copy).not.toBe(obj);
    expect(copy.nested).not.toBe(obj.nested);
  });

  it('deep clones an array', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    const copy = deepClone(arr);
    expect(copy).toEqual(arr);
    copy[0]!.id = 99;
    expect(arr[0]!.id).toBe(1);
  });
});
