import { Record as R } from '../../src/record/index.js';

describe('Record.keys', () => {
  it('returns keys as array', () => {
    expect(R.keys({ a: 1, b: 2 })).toEqual(['a', 'b']);
  });
});

describe('Record.values', () => {
  it('returns values as array', () => {
    expect(R.values({ a: 1, b: 2 })).toEqual([1, 2]);
  });
});

describe('Record.entries', () => {
  it('returns entries as tuples', () => {
    expect(R.entries({ a: 1, b: 2 })).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });
});

describe('Record.has', () => {
  it('checks key existence', () => {
    expect(R.has({ a: 1 }, 'a')).toBe(true);
    expect(R.has({ a: 1 }, 'b')).toBe(false);
  });
});

describe('Record.size', () => {
  it('counts entries', () => {
    expect(R.size({ a: 1, b: 2 })).toBe(2);
    expect(R.size({})).toBe(0);
  });
});

describe('Record.isEmpty', () => {
  it('checks if empty', () => {
    expect(R.isEmpty({})).toBe(true);
    expect(R.isEmpty({ a: 1 })).toBe(false);
  });
});

describe('Record.map', () => {
  it('maps over values', () => {
    const result = R.map({ a: 1, b: 2 }, (v) => v * 2);
    expect(result).toEqual({ a: 2, b: 4 });
  });
});

describe('Record.filter', () => {
  it('filters by predicate', () => {
    const result = R.filter({ a: 1, b: 2, c: 3 }, (v) => v > 1);
    expect(result).toEqual({ b: 2, c: 3 });
  });
});

describe('Record.filterMap', () => {
  it('maps and filters nulls', () => {
    const result = R.filterMap({ a: 1, b: 2 }, (v) => (v > 1 ? v * 2 : null));
    expect(result).toEqual({ b: 4 });
  });
});

describe('Record.upsert', () => {
  it('inserts a new key', () => {
    const result = R.upsert({ a: 1 }, 'b', 2);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('updates an existing key', () => {
    const result = R.upsert({ a: 1 }, 'a', 3);
    expect(result).toEqual({ a: 3 });
  });
});

describe('Record.remove', () => {
  it('removes a key', () => {
    const result = R.remove({ a: 1, b: 2 }, 'a');
    expect(result).toEqual({ b: 2 });
  });
});

describe('Record.pick', () => {
  it('picks selected keys', () => {
    const result = R.pick({ a: 1, b: 2, c: 3 }, 'a', 'c');
    expect(result).toEqual({ a: 1, c: 3 });
  });
});

describe('Record.omit', () => {
  it('omits selected keys', () => {
    const result = R.omit({ a: 1, b: 2, c: 3 }, 'b');
    expect(result).toEqual({ a: 1, c: 3 });
  });
});

describe('Record.reduce', () => {
  it('reduces to a single value', () => {
    const result = R.reduce({ a: 1, b: 2, c: 3 }, 0, (acc, v) => acc + v);
    expect(result).toBe(6);
  });
});

describe('Record.partition', () => {
  it('splits into pass and fail', () => {
    const { pass, fail } = R.partition({ a: 1, b: 2, c: 3 }, (v) => v > 1);
    expect(pass).toEqual({ b: 2, c: 3 });
    expect(fail).toEqual({ a: 1 });
  });
});
