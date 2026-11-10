/**
 * Tree<T>: a recursive tree data structure.
 *
 * Useful for modelling hierarchies: category trees, comment threads,
 * file systems, organisation charts, decision trees.
 *
 * @example
 * import { Tree, drawTree } from 'tsentials/tree';
 *
 * const categoryTree = Tree.of('Electronics', [
 *   Tree.of('Phones', [
 *     Tree.leaf('iPhone'),
 *     Tree.leaf('Android'),
 *   ]),
 *   Tree.leaf('Laptops'),
 * ]);
 *
 * const allNames = Tree.toArray(categoryTree); // ['Electronics', 'Phones', 'iPhone', 'Android', 'Laptops']
 */

/**
 * A node in a tree. Contains a value and zero or more child nodes.
 */
export interface Tree<T> {
  readonly value: T;
  readonly forest: ReadonlyArray<Tree<T>>;
}

// ─── Constructors ────────────────────────────────────────────────────────────

/**
 * Creates a Tree node with children.
 */
export function of<T>(value: T, forest: ReadonlyArray<Tree<T>> = []): Tree<T> {
  return { value, forest };
}

/**
 * Creates a leaf node (a Tree with no children).
 */
export function leaf<T>(value: T): Tree<T> {
  return { value, forest: [] };
}

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Checks if a Tree is a leaf (has no children).
 */
export function isLeaf<T>(tree: Tree<T>): boolean {
  return tree.forest.length === 0;
}

/**
 * Gets the root value of a Tree.
 */
export function root<T>(tree: Tree<T>): T {
  return tree.value;
}

/**
 * Gets the immediate children of a Tree.
 */
export function children<T>(tree: Tree<T>): ReadonlyArray<Tree<T>> {
  return tree.forest;
}

/**
 * Gets the number of nodes in the Tree.
 */
export function size<T>(tree: Tree<T>): number {
  let count = 0;
  const stack: Array<Tree<T>> = [tree];
  for (let t = stack.pop(); t; t = stack.pop()) {
    count++;
    for (const child of t.forest) stack.push(child);
  }
  return count;
}

// All traversals use an explicit stack instead of recursion, so deep trees cannot overflow the call stack.

/** Visits every node in pre-order (parent first, children left to right) until `visit` returns true. */
function preOrder<T>(tree: Tree<T>, visit: (t: Tree<T>, depth: number) => unknown): void {
  const stack: Array<[Tree<T>, number]> = [[tree, 0]];
  for (let top = stack.pop(); top; top = stack.pop()) {
    const [t, depth] = top;
    if (visit(t, depth) === true) return;
    for (let i = t.forest.length - 1; i >= 0; i--) stack.push([t.forest[i] as Tree<T>, depth + 1]);
  }
}

// ─── Transformations ─────────────────────────────────────────────────────────

/**
 * Maps over all values in the Tree, preserving structure. `f` is called in pre-order.
 */
export function map<T, U>(tree: Tree<T>, f: (value: T) => U): Tree<U> {
  const rootForest: Array<Tree<U>> = [];
  const stack: Array<[Tree<T>, Array<Tree<U>>]> = [[tree, rootForest]];
  for (let top = stack.pop(); top; top = stack.pop()) {
    const [t, parentForest] = top;
    const forest: Array<Tree<U>> = [];
    parentForest.push({ value: f(t.value), forest });
    for (let i = t.forest.length - 1; i >= 0; i--) stack.push([t.forest[i] as Tree<T>, forest]);
  }
  return rootForest[0] as Tree<U>;
}

/**
 * Filters the tree, keeping only nodes that match the predicate.
 * A parent is kept if any descendant matches. `predicate` is called in post-order.
 */
export function filter<T>(tree: Tree<T>, predicate: (value: T) => boolean): Tree<T> | null {
  return fold<T, Tree<T> | null>(tree, (value, children) => {
    const forest = children.filter((child): child is Tree<T> => child !== null);
    return predicate(value) || forest.length > 0 ? { value, forest } : null;
  });
}

/**
 * Flattens the Tree into an array using pre-order traversal.
 */
export function toArray<T>(tree: Tree<T>): Array<T> {
  const result: Array<T> = [];
  preOrder(tree, (t) => {
    result.push(t.value);
  });
  return result;
}

/**
 * Flattens the Tree into an array of paths (value + depth).
 */
export function toArrayWithDepth<T>(tree: Tree<T>): Array<{ value: T; depth: number }> {
  const result: Array<{ value: T; depth: number }> = [];
  preOrder(tree, (t, depth) => {
    result.push({ value: t.value, depth });
  });
  return result;
}

/**
 * Finds the first node matching the predicate (depth-first).
 */
export function find<T>(tree: Tree<T>, predicate: (value: T) => boolean): Tree<T> | null {
  let found: Tree<T> | null = null;
  preOrder(tree, (t) => {
    if (!predicate(t.value)) return false;
    found = t;
    return true;
  });
  return found;
}

/**
 * Finds all nodes matching the predicate.
 */
export function findAll<T>(tree: Tree<T>, predicate: (value: T) => boolean): Array<Tree<T>> {
  const result: Array<Tree<T>> = [];
  preOrder(tree, (t) => {
    if (predicate(t.value)) result.push(t);
  });
  return result;
}

// ─── Folding ─────────────────────────────────────────────────────────────────

/**
 * Folds the Tree into a single value (post-order traversal).
 */
export function fold<T, U>(tree: Tree<T>, f: (value: T, children: ReadonlyArray<U>) => U): U {
  type Frame = { tree: Tree<T>; next: number; results: Array<U> };
  const stack: Array<Frame> = [{ tree, next: 0, results: [] }];
  for (;;) {
    const top = stack[stack.length - 1] as Frame;
    if (top.next < top.tree.forest.length) {
      stack.push({ tree: top.tree.forest[top.next++] as Tree<T>, next: 0, results: [] });
      continue;
    }
    stack.pop();
    const result = f(top.tree.value, top.results);
    const parent = stack[stack.length - 1];
    if (!parent) return result;
    parent.results.push(result);
  }
}

// ─── Pretty printing ─────────────────────────────────────────────────────────

/**
 * Draws a Tree as an indented string.
 */
export function drawTree<T>(tree: Tree<T>, show: (value: T) => string = String): string {
  const lines: Array<string> = [];
  // head prefixes a node's first line, indent its other lines and its children's lines.
  const stack: Array<[Tree<T>, string, string]> = [[tree, '', '']];
  for (let top = stack.pop(); top; top = stack.pop()) {
    const [t, head, indent] = top;
    const [first, ...rest] = show(t.value).split('\n');
    lines.push(head + first);
    for (const line of rest) lines.push(indent + line);
    for (let i = t.forest.length - 1; i >= 0; i--) {
      const isLast = i === t.forest.length - 1;
      stack.push([
        t.forest[i] as Tree<T>,
        indent + (isLast ? '└── ' : '├── '),
        indent + (isLast ? '    ' : '│   '),
      ]);
    }
  }
  return lines.join('\n');
}

// ─── Namespace ───────────────────────────────────────────────────────────────

export const Tree = {
  of,
  leaf,
  isLeaf,
  root,
  children,
  size,
  map,
  filter,
  toArray,
  toArrayWithDepth,
  find,
  findAll,
  fold,
  drawTree,
} as const;
