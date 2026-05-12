import { Union } from '../../src/union/union.js';

type Shape = Union<{
  circle: { radius: number };
  rect: { width: number; height: number };
  triangle: { base: number; height: number };
}>;

describe('Union.of', () => {
  it('creates a tagged union value', () => {
    const circle = Union.of<{ circle: { radius: number }; rect: { width: number; height: number }; triangle: { base: number; height: number } }, 'circle'>('circle', { radius: 5 });
    expect(circle.tag).toBe('circle');
    expect(circle.value).toEqual({ radius: 5 });
  });
});

describe('Union.match', () => {
  it('calls the correct handler', () => {
    const circle: Shape = { tag: 'circle', value: { radius: 10 } };
    const area = Union.match(circle, {
      circle: ({ radius }) => Math.PI * radius * radius,
      rect: ({ width, height }) => width * height,
      triangle: ({ base, height }) => 0.5 * base * height,
    });
    expect(area).toBeCloseTo(Math.PI * 100);
  });

  it('dispatches rect correctly', () => {
    const rect: Shape = { tag: 'rect', value: { width: 4, height: 5 } };
    const area = Union.match(rect, {
      circle: ({ radius }) => Math.PI * radius * radius,
      rect: ({ width, height }) => width * height,
      triangle: ({ base, height }) => 0.5 * base * height,
    });
    expect(area).toBe(20);
  });
});

describe('Union.is', () => {
  it('returns true for matching tag', () => {
    const circle: Shape = { tag: 'circle', value: { radius: 5 } };
    expect(Union.is(circle, 'circle')).toBe(true);
  });

  it('returns false for non-matching tag', () => {
    const circle: Shape = { tag: 'circle', value: { radius: 5 } };
    expect(Union.is(circle, 'rect')).toBe(false);
  });
});

describe('Union.get', () => {
  it('returns value for matching tag', () => {
    const rect: Shape = { tag: 'rect', value: { width: 3, height: 4 } };
    const value = Union.get(rect, 'rect');
    expect(value.width).toBe(3);
  });

  it('throws for non-matching tag', () => {
    const circle: Shape = { tag: 'circle', value: { radius: 5 } };
    expect(() => Union.get(circle, 'rect')).toThrow();
  });
});
