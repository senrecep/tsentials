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
    const sum = Tree.fold<number, number>(
      t,
      (value, children) => value + children.reduce((a, b) => a + b, 0),
    );
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

describe('Tree on deep trees', () => {
  const depth = 100_000;
  // A chain root 0 -> 1 -> ... -> depth - 1, built bottom-up without recursion.
  let deep: Tree<number> = Tree.leaf(depth - 1);
  for (let i = depth - 2; i >= 0; i--) deep = Tree.of(i, [deep]);

  it('size, toArray and toArrayWithDepth do not overflow the stack', () => {
    expect(Tree.size(deep)).toBe(depth);
    const values = Tree.toArray(deep);
    expect(values).toHaveLength(depth);
    expect(values[0]).toBe(0);
    expect(values[depth - 1]).toBe(depth - 1);
    const withDepth = Tree.toArrayWithDepth(deep);
    expect(withDepth[depth - 1]).toEqual({ value: depth - 1, depth: depth - 1 });
  });

  it('map, filter and fold do not overflow the stack', () => {
    const mapped = Tree.map(deep, (n) => n * 2);
    expect(Tree.size(mapped)).toBe(depth);
    expect(Tree.toArray(mapped)[depth - 1]).toBe((depth - 1) * 2);
    const filtered = Tree.filter(deep, (n) => n === depth - 1);
    expect(filtered).not.toBeNull();
    expect(Tree.size(filtered as Tree<number>)).toBe(depth);
    expect(Tree.filter(deep, () => false)).toBeNull();
    expect(
      Tree.fold(deep, (_v, cs: ReadonlyArray<number>) => 1 + cs.reduce((a, b) => a + b, 0)),
    ).toBe(depth);
  });

  it('find and findAll do not overflow the stack', () => {
    expect(Tree.find(deep, (n) => n === depth - 1)?.value).toBe(depth - 1);
    expect(Tree.find(deep, () => false)).toBeNull();
    expect(Tree.findAll(deep, (n) => n % 2 === 0)).toHaveLength(depth / 2);
  });

  it('drawTree does not overflow the stack', () => {
    // The output grows quadratically with depth, so use a chain just deeper than the old recursion allowed (about 6k).
    const chainDepth = 8_000;
    let chain: Tree<string> = Tree.leaf('');
    for (let i = 0; i < chainDepth; i++) chain = Tree.of('', [chain]);
    const lines = Tree.drawTree(chain).split('\n');
    expect(lines).toHaveLength(chainDepth + 1);
    expect(lines[chainDepth]).toBe(`${' '.repeat(4 * (chainDepth - 1))}└── `);
  });
});

describe('Tree traversal order', () => {
  const t = Tree.of('r', [
    Tree.of('a', [Tree.leaf('a1'), Tree.leaf('a2')]),
    Tree.leaf('b'),
    Tree.of('c', [Tree.leaf('c1')]),
  ]);

  it('map calls f in pre-order and keeps the structure', () => {
    const calls: string[] = [];
    const mapped = Tree.map(t, (v) => {
      calls.push(v);
      return v.toUpperCase();
    });
    expect(calls).toEqual(['r', 'a', 'a1', 'a2', 'b', 'c', 'c1']);
    expect(mapped).toEqual(
      Tree.of('R', [
        Tree.of('A', [Tree.leaf('A1'), Tree.leaf('A2')]),
        Tree.leaf('B'),
        Tree.of('C', [Tree.leaf('C1')]),
      ]),
    );
  });

  it('fold and filter visit in post-order', () => {
    const foldCalls: string[] = [];
    Tree.fold(t, (v, _cs: ReadonlyArray<null>) => {
      foldCalls.push(v);
      return null;
    });
    expect(foldCalls).toEqual(['a1', 'a2', 'a', 'b', 'c1', 'c', 'r']);
    const predCalls: string[] = [];
    const filtered = Tree.filter(t, (v) => {
      predCalls.push(v);
      return v === 'a2' || v === 'b';
    });
    expect(predCalls).toEqual(['a1', 'a2', 'a', 'b', 'c1', 'c', 'r']);
    expect(filtered).toEqual(Tree.of('r', [Tree.of('a', [Tree.leaf('a2')]), Tree.leaf('b')]));
  });

  it('find, findAll and toArrayWithDepth use pre-order', () => {
    const seen: string[] = [];
    expect(
      Tree.find(t, (v) => {
        seen.push(v);
        return v === 'b';
      })?.value,
    ).toBe('b');
    expect(seen).toEqual(['r', 'a', 'a1', 'a2', 'b']);
    expect(Tree.findAll(t, (v) => v.length === 2).map((n) => n.value)).toEqual(['a1', 'a2', 'c1']);
    expect(Tree.toArrayWithDepth(t).map((e) => `${e.value}:${e.depth}`)).toEqual([
      'r:0',
      'a:1',
      'a1:2',
      'a2:2',
      'b:1',
      'c:1',
      'c1:2',
    ]);
  });

  it('drawTree draws nested and multi-line values', () => {
    expect(Tree.drawTree(t)).toBe(
      ['r', '├── a', '│   ├── a1', '│   └── a2', '├── b', '└── c', '    └── c1'].join('\n'),
    );
    const multi = Tree.of('x\ny', [Tree.of('p\nq', [Tree.leaf('z')]), Tree.leaf('w')]);
    expect(Tree.drawTree(multi)).toBe(
      ['x', 'y', '├── p', '│   q', '│   └── z', '└── w'].join('\n'),
    );
  });
});
