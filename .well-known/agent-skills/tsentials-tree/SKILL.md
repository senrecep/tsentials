# tsentials/tree — Skill

Use when modelling recursive hierarchies: categories, comments, org charts.

## API

```typescript
import { Tree } from 'tsentials/tree';
import type { Tree as TreeType } from 'tsentials/tree'; // interface: { value: T; forest: ReadonlyArray<Tree<T>> }

// Construction
const t = Tree.of('root', [
  Tree.of('a', [Tree.leaf('a1')]),
  Tree.leaf('b'),
]);

// Query
Tree.root(t);        // 'root' — get root value
Tree.children(t);    // immediate child Tree nodes
Tree.size(t);        // total nodes
Tree.isLeaf(t);      // has no children?
Tree.find(t, v => v === 'a1');
Tree.findAll(t, v => v.startsWith('a'));

// Transform
Tree.map(t, v => v.toUpperCase());
Tree.filter(t, v => v !== 'b');
Tree.toArray(t);     // pre-order flatten
Tree.toArrayWithDepth(t); // [{ value: 'root', depth: 0 }, { value: 'a', depth: 1 }, ...]

// Fold
Tree.fold(t, (value, children) => value + children.reduce((a, b) => a + b, 0));

// Pretty print
Tree.drawTree(t);                       // uses String() by default
Tree.drawTree(t, v => v.toUpperCase()); // custom show function
```

## Patterns

- Use `Tree` for any nested structure where parent-child relationships matter.
- Use `fold` for recursive aggregation (sums, validation, rendering).
