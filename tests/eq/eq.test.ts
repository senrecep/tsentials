import { Eq } from '../../src/eq/index.js';

describe('Eq primitives', () => {
  it('strict equals uses ===', () => {
    expect(Eq.strict.equals(1, 1)).toBe(true);
    expect(Eq.strict.equals(1, 2)).toBe(false);
    expect(Eq.strict.equals({}, {})).toBe(false);
  });

  it('number equals', () => {
    expect(Eq.number.equals(1, 1)).toBe(true);
    expect(Eq.number.equals(1, 2)).toBe(false);
  });

  it('string equals', () => {
    expect(Eq.string.equals('a', 'a')).toBe(true);
    expect(Eq.string.equals('a', 'b')).toBe(false);
  });

  it('boolean equals', () => {
    expect(Eq.boolean.equals(true, true)).toBe(true);
    expect(Eq.boolean.equals(true, false)).toBe(false);
  });

  it('date equals compares timestamps', () => {
    expect(Eq.date.equals(new Date('2024-01-01'), new Date('2024-01-01'))).toBe(true);
    expect(Eq.date.equals(new Date('2024-01-01'), new Date('2024-01-02'))).toBe(false);
  });
});

describe('Eq contramap', () => {
  it('derives Eq from a projection', () => {
    interface User {
      readonly id: number;
      readonly name: string;
    }
    const eqById = Eq.contramap(Eq.number, (u: User) => u.id);
    expect(eqById.equals({ id: 1, name: 'A' }, { id: 1, name: 'B' })).toBe(true);
    expect(eqById.equals({ id: 1, name: 'A' }, { id: 2, name: 'A' })).toBe(false);
  });
});

describe('Eq struct', () => {
  it('compares objects field-by-field', () => {
    interface Point {
      readonly x: number;
      readonly y: number;
    }
    const eqPoint = Eq.struct<Point>({ x: Eq.number, y: Eq.number });
    expect(eqPoint.equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(eqPoint.equals({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
  });
});

describe('Eq getArrayEq', () => {
  it('compares arrays element-wise', () => {
    const eq = Eq.getArrayEq(Eq.number);
    expect(eq.equals([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(eq.equals([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(eq.equals([1, 2], [1, 2, 3])).toBe(false);
  });
});
