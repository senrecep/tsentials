import { Tree } from '../../src/tree/index.js';

describe('Tree constructors', () => {
  it('creates a leaf', () => {
    const t = Tree.leaf('a');
    expect(Tree.isLeaf(t)).toBe(true);
    expect(t.value).toBe('a');
    expect(t.forest).toHaveLength(0);
  });

  it('creates a tree with children', () => {
    const t = Tree.of('root', [Tree.leaf('a'), Tree.leaf('b')]);
    expect(Tree.isLeaf(t)).toBe(false);
    expect(t.forest).toHaveLength(2);
  });
});

describe('Tree.query', () => {
  it('root returns the root value', () => {
    expect(Tree.root(Tree.leaf(42))).toBe(42);
  });

  it('children returns immediate children', () => {
    const t = Tree.of('root', [Tree.leaf('a'), Tree.leaf('b')]);
    expect(Tree.children(t)).toHaveLength(2);
  });

  it('size counts all nodes', () => {
    const t = Tree.of('root', [Tree.of('a', [Tree.leaf('a1')]), Tree.leaf('b')]);
    expect(Tree.size(t)).toBe(4);
  });
});

describe('Tree.map', () => {
  it('maps over all values preserving structure', () => {
    const t = Tree.of(1, [Tree.of(2, [Tree.leaf(3)]), Tree.leaf(4)]);
    const doubled = Tree.map(t, (n) => n * 2);
    expect(Tree.toArray(doubled)).toEqual([2, 4, 6, 8]);
  });
});

describe('Tree.filter', () => {
  it('keeps nodes matching predicate and their ancestors', () => {
    const t = Tree.of('root', [Tree.leaf('keep'), Tree.leaf('drop')]);
    const filtered = Tree.filter(t, (v) => v === 'keep');
    expect(filtered).not.toBeNull();
    if (filtered) {
      expect(Tree.toArray(filtered)).toEqual(['root', 'keep']);
    }
  });

  it('returns null when nothing matches', () => {
    const t = Tree.leaf('a');
    expect(Tree.filter(t, () => false)).toBeNull();
  });
});

describe('Tree.toArray', () => {
  it('flattens in pre-order', () => {
    const t = Tree.of(1, [Tree.of(2, [Tree.leaf(3)]), Tree.leaf(4)]);
    expect(Tree.toArray(t)).toEqual([1, 2, 3, 4]);
  });
});

describe('Tree.toArrayWithDepth', () => {
  it('includes depth information', () => {
    const t = Tree.of('a', [Tree.leaf('b')]);
    const result = Tree.toArrayWithDepth(t);
    expect(result).toEqual([
      { value: 'a', depth: 0 },
      { value: 'b', depth: 1 },
    ]);
  });
});

describe('Tree.find', () => {
  it('finds the first matching node', () => {
    const t = Tree.of(1, [Tree.leaf(2), Tree.leaf(3)]);
    const found = Tree.find(t, (n) => n === 3);
    expect(found).not.toBeNull();
    if (found) expect(found.value).toBe(3);
  });

  it('returns null when not found', () => {
    const t = Tree.leaf(1);
    expect(Tree.find(t, () => false)).toBeNull();
  });
});

describe('Tree.findAll', () => {
  it('finds all matching nodes', () => {
    const t = Tree.of(1, [Tree.leaf(2), Tree.leaf(2)]);
    const found = Tree.findAll(t, (n) => n === 2);
    expect(found).toHaveLength(2);
  });
});

describe('Tree.fold', () => {
  it('folds the tree into a single value', () => {
    const t = Tree.of(1, [Tree.of(2, [Tree.leaf(3)]), Tree.leaf(4)]);
    const sum = Tree.fold(t, (value, children) => value + children.reduce((a, b) => a + b, 0));
    expect(sum).toBe(10);
  });
});

describe('Tree.drawTree', () => {
  it('draws a tree as string', () => {
    const t = Tree.of('a', [Tree.leaf('b')]);
    const drawing = Tree.drawTree(t);
    expect(drawing).toContain('a');
    expect(drawing).toContain('b');
  });
});
