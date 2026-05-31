import { Union } from '../../src/union/union.js';

type Shape = Union<{
  circle: { radius: number };
  rect: { width: number; height: number };
  triangle: { base: number; height: number };
}>;

describe('Union.of', () => {
  it('creates a tagged union value', () => {
    const circle = Union.of<
      {
        circle: { radius: number };
        rect: { width: number; height: number };
        triangle: { base: number; height: number };
      },
      'circle'
    >('circle', { radius: 5 });
    expect(circle.tag).toBe('circle');
    expect(circle.value).toEqual({ radius: 5 });
  });

  it('returns frozen value', () => {
    const circle = Union.of<{ circle: { radius: number } }, 'circle'>('circle', { radius: 5 });
    expect(Object.isFrozen(circle)).toBe(true);
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

  it('dispatches triangle correctly', () => {
    const triangle: Shape = { tag: 'triangle', value: { base: 10, height: 4 } };
    const area = Union.match(triangle, {
      circle: ({ radius }) => Math.PI * radius * radius,
      rect: ({ width, height }) => width * height,
      triangle: ({ base, height }) => 0.5 * base * height,
    });
    expect(area).toBe(20);
  });

  it('throws on unhandled tag', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional test of runtime behavior with unknown tag
    const unknown = { tag: 'unknown', value: {} } as any;
    expect(() =>
      Union.match(unknown, {
        circle: () => 1,
        rect: () => 2,
        triangle: () => 3,
      }),
    ).toThrow('Unhandled union tag: unknown');
  });

  it('returns different types from handlers', () => {
    const rect: Shape = { tag: 'rect', value: { width: 4, height: 5 } };
    const result = Union.match(rect, {
      circle: () => 'circle',
      rect: () => 42,
      triangle: () => true,
    });
    expect(result).toBe(42);
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

  it('narrows type at runtime', () => {
    const shape: Shape = { tag: 'rect', value: { width: 3, height: 4 } };
    if (Union.is(shape, 'rect')) {
      expect(shape.value.width).toBe(3);
    }
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
    expect(() => Union.get(circle, 'rect')).toThrow("Expected union tag 'rect' but got 'circle'.");
  });

  it('throws with correct message for another mismatch', () => {
    const triangle: Shape = { tag: 'triangle', value: { base: 10, height: 5 } };
    expect(() => Union.get(triangle, 'circle')).toThrow(
      "Expected union tag 'circle' but got 'triangle'.",
    );
  });
});

describe('Union.partition', () => {
  it('partitions circles and rects from a mixed array', () => {
    const shapes: Shape[] = [
      { tag: 'circle', value: { radius: 5 } },
      { tag: 'rect', value: { width: 3, height: 4 } },
      { tag: 'circle', value: { radius: 10 } },
    ];
    const { lefts, rights } = Union.partition(shapes, 'circle', 'rect');
    expect(lefts).toEqual([{ radius: 5 }, { radius: 10 }]);
    expect(rights).toEqual([{ width: 3, height: 4 }]);
  });

  it('partitions all variants including triangle', () => {
    const shapes: Shape[] = [
      { tag: 'circle', value: { radius: 1 } },
      { tag: 'triangle', value: { base: 2, height: 3 } },
      { tag: 'rect', value: { width: 4, height: 5 } },
      { tag: 'triangle', value: { base: 6, height: 7 } },
    ];
    const { lefts, rights } = Union.partition(shapes, 'circle', 'rect');
    expect(lefts).toEqual([{ radius: 1 }]);
    expect(rights).toEqual([{ width: 4, height: 5 }]);
  });

  it('returns empty arrays for an empty input', () => {
    const { lefts, rights } = Union.partition([], 'circle', 'rect');
    expect(lefts).toEqual([]);
    expect(rights).toEqual([]);
  });

  it('returns only lefts when no rightTag items exist', () => {
    const shapes: Shape[] = [
      { tag: 'circle', value: { radius: 3 } },
      { tag: 'circle', value: { radius: 7 } },
    ];
    const { lefts, rights } = Union.partition(shapes, 'circle', 'rect');
    expect(lefts).toEqual([{ radius: 3 }, { radius: 7 }]);
    expect(rights).toEqual([]);
  });

  it('returns only rights when no leftTag items exist', () => {
    const shapes: Shape[] = [
      { tag: 'rect', value: { width: 1, height: 2 } },
    ];
    const { lefts, rights } = Union.partition(shapes, 'circle', 'rect');
    expect(lefts).toEqual([]);
    expect(rights).toEqual([{ width: 1, height: 2 }]);
  });
});

describe('Union.groupBy', () => {
  it('groups a mixed array by tag', () => {
    const shapes: Shape[] = [
      { tag: 'circle', value: { radius: 1 } },
      { tag: 'rect', value: { width: 2, height: 3 } },
      { tag: 'circle', value: { radius: 4 } },
      { tag: 'triangle', value: { base: 5, height: 6 } },
    ];
    const groups = Union.groupBy(shapes);
    expect(groups.circle).toEqual([{ radius: 1 }, { radius: 4 }]);
    expect(groups.rect).toEqual([{ width: 2, height: 3 }]);
    expect(groups.triangle).toEqual([{ base: 5, height: 6 }]);
  });

  it('returns empty object for empty input', () => {
    const groups = Union.groupBy<{
      circle: { radius: number };
      rect: { width: number; height: number };
      triangle: { base: number; height: number };
    }>([]);
    expect(groups).toEqual({});
  });

  it('groups array with only one tag type', () => {
    const shapes: Shape[] = [
      { tag: 'circle', value: { radius: 10 } },
      { tag: 'circle', value: { radius: 20 } },
    ];
    const groups = Union.groupBy(shapes);
    expect(groups.circle).toEqual([{ radius: 10 }, { radius: 20 }]);
    expect(groups.rect).toBeUndefined();
    expect(groups.triangle).toBeUndefined();
  });

  it('groups multiple tags independently', () => {
    const shapes: Shape[] = [
      { tag: 'rect', value: { width: 1, height: 2 } },
      { tag: 'triangle', value: { base: 3, height: 4 } },
      { tag: 'rect', value: { width: 5, height: 6 } },
    ];
    const groups = Union.groupBy(shapes);
    expect(groups.rect).toHaveLength(2);
    expect(groups.triangle).toHaveLength(1);
    expect(groups.circle).toBeUndefined();
  });
});
