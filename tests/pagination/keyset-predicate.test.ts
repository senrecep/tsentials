import {
  compareKeyset,
  type KeysetComparison,
  type KeysetPredicate,
  type KeysetValue,
  keysetOrdering,
  keysetPredicate,
  keysetPredicateToSql,
} from '../../src/pagination/index.js';

interface Row {
  id: number;
  createdAt: Date;
  name: string;
}

const START = Date.UTC(2024, 0, 1);
// Rows 10..16 share createdAt, and names repeat, so later keys decide ties.
const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  createdAt: new Date(START + (i >= 10 && i <= 16 ? 100 : i) * 3_600_000),
  name: `n${i % 3}`,
}));

const mixed = keysetOrdering<Row>('Row')
  .descending('createdAt', 'date')
  .ascending('name', 'string')
  .ascending('id', 'number');

const keysOf = (row: Row): KeysetValue[] => [row.createdAt, row.name, row.id];

const holds = (c: KeysetComparison, row: Row): boolean => {
  const order = compareKeyset(
    keysetOrdering<Row>('x').ascending(
      c.path,
      mixed.keys.find((k) => k.path === c.path)?.kind ?? 'number',
    ),
    [row[c.path as keyof Row]],
    [c.value],
  );
  switch (c.operator) {
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '=':
      return order === 0;
  }
};

const evaluate = (p: KeysetPredicate, row: Row): boolean =>
  (p.seek === undefined || holds(p.seek, row)) &&
  p.anyOf.some((and) => and.every((c) => holds(c, row)));

describe('keysetPredicate', () => {
  it('selects exactly the rows compareKeyset puts beyond the cursor, for mixed directions', () => {
    for (const cursorRow of rows) {
      for (const reverse of [false, true]) {
        const predicate = keysetPredicate(mixed, keysOf(cursorRow), reverse);
        for (const row of rows) {
          expect(evaluate(predicate, row)).toBe(
            compareKeyset(mixed, keysOf(row), keysOf(cursorRow), reverse) > 0,
          );
        }
      }
    }
  });

  it('builds the C# shape: inclusive seek on the first key, then OR of ANDs', () => {
    const at = new Date(START);
    expect(keysetPredicate(mixed, [at, 'b', 7])).toEqual({
      seek: { path: 'createdAt', operator: '<=', value: at },
      anyOf: [
        [{ path: 'createdAt', operator: '<', value: at }],
        [
          { path: 'createdAt', operator: '=', value: at },
          { path: 'name', operator: '>', value: 'b' },
        ],
        [
          { path: 'createdAt', operator: '=', value: at },
          { path: 'name', operator: '=', value: 'b' },
          { path: 'id', operator: '>', value: 7 },
        ],
      ],
    });
  });

  it('inverts every key for a before page', () => {
    const p = keysetPredicate(mixed, [new Date(START), 'b', 7], true);
    expect(p.seek?.operator).toBe('>=');
    expect(p.anyOf.map((and) => and[and.length - 1]?.operator)).toEqual(['>', '<', '<']);
  });

  it('has no seek for a single key', () => {
    const byId = keysetOrdering<Row>('Row').ascending('id', 'number');
    expect(keysetPredicate(byId, [3])).toEqual({
      seek: undefined,
      anyOf: [[{ path: 'id', operator: '>', value: 3 }]],
    });
  });

  it('rejects an empty ordering, a wrong cursor length and null values', () => {
    expect(() => keysetPredicate(keysetOrdering<Row>('Row'), [])).toThrow(TypeError);
    expect(() => keysetPredicate(mixed, [new Date(START), 'b'])).toThrow(/3 keys/);
    expect(() => keysetPredicate(mixed, [new Date(START), null as unknown as string, 1])).toThrow(
      /'name' has a null cursor value/,
    );
  });
});

describe('keysetPredicateToSql', () => {
  const columns = { createdAt: '"created_at"', name: '"name"', id: '"id"' };

  it('renders a parameterised WHERE fragment with values in placeholder order', () => {
    const at = new Date(START);
    const sql = keysetPredicateToSql(keysetPredicate(mixed, [at, "x' OR 1=1 --", 7]), {
      columns,
    });
    expect(sql.sql).toBe(
      '"created_at" <= ? AND ("created_at" < ? OR ("created_at" = ? AND "name" > ?) OR ("created_at" = ? AND "name" = ? AND "id" > ?))',
    );
    expect(sql.values).toEqual([at, at, at, "x' OR 1=1 --", at, "x' OR 1=1 --", 7]);
  });

  it('supports numbered placeholders', () => {
    const byId = keysetOrdering<Row>('Row')
      .descending('createdAt', 'date')
      .ascending('id', 'number');
    const at = new Date(START);
    const sql = keysetPredicateToSql(keysetPredicate(byId, [at, 5]), {
      columns,
      placeholder: (i) => `$${i}`,
    });
    expect(sql.sql).toBe(
      '"created_at" <= $1 AND ("created_at" < $2 OR ("created_at" = $3 AND "id" > $4))',
    );
    expect(sql.values).toEqual([at, at, at, 5]);
  });

  it('renders a single key without parentheses', () => {
    const byId = keysetOrdering<Row>('Row').ascending('id', 'number');
    expect(keysetPredicateToSql(keysetPredicate(byId, [3]), { columns })).toEqual({
      sql: '"id" > ?',
      values: [3],
    });
  });

  it('throws for a key path without a column mapping, never using the path itself', () => {
    const p = keysetPredicate(mixed, [new Date(START), 'b', 7]);
    expect(() => keysetPredicateToSql(p, { columns: { createdAt: 'c', id: 'i' } })).toThrow(
      /No SQL column is mapped for keyset key 'name'/,
    );
    expect(() => keysetPredicateToSql(p, { columns: Object.create({ name: 'n' }) })).toThrow(
      TypeError,
    );
  });
});
