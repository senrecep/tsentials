/**
 * Tree<T> — a recursive tree data structure.
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
 * Gets the number of nodes in the Tree (recursive).
 */
export function size<T>(tree: Tree<T>): number {
  return 1 + tree.forest.reduce((acc, child) => acc + size(child), 0);
}

// ─── Transformations ─────────────────────────────────────────────────────────

/**
 * Maps over all values in the Tree, preserving structure.
 */
export function map<T, U>(tree: Tree<T>, f: (value: T) => U): Tree<U> {
  return {
    value: f(tree.value),
    forest: tree.forest.map((child) => map(child, f)),
  };
}

/**
 * Filters the tree, keeping only nodes that match the predicate.
 * A parent is kept if any descendant matches.
 */
export function filter<T>(tree: Tree<T>, predicate: (value: T) => boolean): Tree<T> | null {
  const filteredChildren = tree.forest
    .map((child) => filter(child, predicate))
    .filter((child): child is Tree<T> => child !== null);

  if (predicate(tree.value) || filteredChildren.length > 0) {
    return { value: tree.value, forest: filteredChildren };
  }

  return null;
}

/**
 * Flattens the Tree into an array using pre-order traversal.
 */
export function toArray<T>(tree: Tree<T>): Array<T> {
  const result: Array<T> = [];
  function traverse(t: Tree<T>): void {
    result.push(t.value);
    for (const child of t.forest) traverse(child);
  }
  traverse(tree);
  return result;
}

/**
 * Flattens the Tree into an array of paths (value + depth).
 */
export function toArrayWithDepth<T>(tree: Tree<T>): Array<{ value: T; depth: number }> {
  const result: Array<{ value: T; depth: number }> = [];
  function traverse(t: Tree<T>, depth: number): void {
    result.push({ value: t.value, depth });
    for (const child of t.forest) traverse(child, depth + 1);
  }
  traverse(tree, 0);
  return result;
}

/**
 * Finds the first node matching the predicate (depth-first).
 */
export function find<T>(tree: Tree<T>, predicate: (value: T) => boolean): Tree<T> | null {
  if (predicate(tree.value)) return tree;
  for (const child of tree.forest) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

/**
 * Finds all nodes matching the predicate.
 */
export function findAll<T>(tree: Tree<T>, predicate: (value: T) => boolean): Array<Tree<T>> {
  const result: Array<Tree<T>> = [];
  function traverse(t: Tree<T>): void {
    if (predicate(t.value)) result.push(t);
    for (const child of t.forest) traverse(child);
  }
  traverse(tree);
  return result;
}

// ─── Folding ─────────────────────────────────────────────────────────────────

/**
 * Folds the Tree into a single value (post-order traversal).
 */
export function fold<T, U>(tree: Tree<T>, f: (value: T, children: ReadonlyArray<U>) => U): U {
  const childResults = tree.forest.map((child) => fold(child, f));
  return f(tree.value, childResults);
}

// ─── Pretty printing ─────────────────────────────────────────────────────────

/**
 * Draws a Tree as an indented string.
 */
export function drawTree<T>(tree: Tree<T>, show: (value: T) => string = String): string {
  function draw(t: Tree<T>, prefix: string): string {
    const lines = [prefix + show(t.value)];
    for (let i = 0; i < t.forest.length; i++) {
      const isLast = i === t.forest.length - 1;
      const childPrefix = prefix + (isLast ? '└── ' : '├── ');
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      const childLines = draw(t.forest[i] as Tree<T>, '').split('\n');
      lines.push(childPrefix + childLines[0]);
      for (let j = 1; j < childLines.length; j++) {
        lines.push(nextPrefix + childLines[j]);
      }
    }
    return lines.join('\n');
  }
  return draw(tree, '');
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
