import {
  createPaginationResponse,
  normalizeCursorRequest,
  normalizePaginationRequest,
  PAGINATION_DEFAULTS,
  paginate,
  skipCount,
} from '../../src/pagination/index.js';

const INT_MAX = 2_147_483_647;
const INT_MIN = -2_147_483_648;

describe('normalizePaginationRequest', () => {
  it('max page size default is 100', () => {
    expect(PAGINATION_DEFAULTS.maxPageSize).toBe(100);
  });

  it('clamps negative values and trims search', () => {
    expect(normalizePaginationRequest({ pageNumber: -5, pageSize: -1, search: '  abc ' })).toEqual({
      pageNumber: 1,
      pageSize: 1,
      search: 'abc',
    });
  });

  it('keeps valid values', () => {
    expect(normalizePaginationRequest({ pageNumber: 3, pageSize: 25 })).toEqual({
      pageNumber: 3,
      pageSize: 25,
      search: undefined,
    });
  });

  it('treats missing and NaN as 0 and truncates fractions', () => {
    expect(normalizePaginationRequest({})).toMatchObject({ pageNumber: 1, pageSize: 1 });
    expect(normalizePaginationRequest({ pageNumber: Number.NaN, pageSize: 7.9 })).toMatchObject({
      pageNumber: 1,
      pageSize: 7,
    });
  });

  it.each([99, 100])('keeps page size %i at or below the default max', (pageSize) => {
    expect(normalizePaginationRequest({ pageNumber: 1, pageSize }).pageSize).toBe(pageSize);
  });

  it('lowers page size above the default max', () => {
    expect(normalizePaginationRequest({ pageNumber: 1, pageSize: 101 }).pageSize).toBe(100);
    expect(normalizePaginationRequest({ pageNumber: 1, pageSize: 5000 }).pageSize).toBe(100);
  });

  it('honours an explicit cap', () => {
    expect(normalizePaginationRequest({ pageSize: 250 }, 500).pageSize).toBe(250);
    expect(normalizePaginationRequest({ pageSize: 5000 }, INT_MAX).pageSize).toBe(5000);
    expect(normalizePaginationRequest({ pageSize: 50 }, 1).pageSize).toBe(1);
    expect(normalizePaginationRequest({ pageSize: 30 }, 30).pageSize).toBe(30);
  });

  it.each([0, -1, Number.NaN])('throws for invalid cap %d', (cap) => {
    expect(() => normalizePaginationRequest({}, cap)).toThrow(RangeError);
  });

  it('does not mutate the input', () => {
    const request = { pageNumber: 0, pageSize: 0 };
    normalizePaginationRequest(request);
    expect(request).toEqual({ pageNumber: 0, pageSize: 0 });
  });
});

describe('skipCount', () => {
  it('calculates (page - 1) * size', () => {
    expect(skipCount({ pageNumber: 3, pageSize: 10 })).toBe(20);
    expect(skipCount(normalizePaginationRequest({ pageNumber: 0, pageSize: 10 }))).toBe(0);
  });

  it.each([
    [INT_MAX, 100],
    [INT_MAX, INT_MAX],
    [21_474_838, 100],
    [2, INT_MAX],
  ])('clamps to int max for page %i size %i', (pageNumber, pageSize) => {
    expect(skipCount({ pageNumber, pageSize })).toBe(INT_MAX);
  });

  it.each([
    [21_474_836, 100, 2_147_483_500],
    [1, 100, 0],
    [0, 100, 0],
    [INT_MIN, INT_MAX, 0],
  ])('page %i size %i → %i', (pageNumber, pageSize, expected) => {
    expect(skipCount({ pageNumber, pageSize })).toBe(expected);
  });
});

describe('normalizeCursorRequest', () => {
  it('default limit is ten', () => {
    expect(normalizeCursorRequest({}).limit).toBe(10);
  });

  it('raises a negative limit and trims search', () => {
    expect(normalizeCursorRequest({ limit: -3, search: ' x ' })).toEqual({
      cursor: undefined,
      limit: 1,
      search: 'x',
    });
  });

  it('does not lower a large limit without cap', () => {
    expect(normalizeCursorRequest({ limit: 10_000 }).limit).toBe(10_000);
  });

  it('applies a cap', () => {
    expect(normalizeCursorRequest({ limit: 50 }, 50).limit).toBe(50);
    expect(normalizeCursorRequest({ limit: 51 }, 50).limit).toBe(50);
    expect(normalizeCursorRequest({ limit: -1 }, 50).limit).toBe(1);
  });

  it.each([0, -1])('throws for invalid cap %i', (cap) => {
    expect(() => normalizeCursorRequest({}, cap)).toThrow(RangeError);
  });

  it('keeps the cursor', () => {
    expect(normalizeCursorRequest({ cursor: 42, limit: 5 }).cursor).toBe(42);
  });
});

describe('createPaginationResponse', () => {
  it('computes total pages', () => {
    expect(createPaginationResponse([], 1, 10, 100).totalPages).toBe(10);
    expect(createPaginationResponse([], 1, 10, 101).totalPages).toBe(11);
    expect(createPaginationResponse([], 1, 0, 37).totalPages).toBe(37);
    expect(createPaginationResponse([], 1, 10, -1).totalPages).toBe(0);
  });

  it('computes previous / next flags', () => {
    expect(createPaginationResponse([], 1, 10, 30).hasPreviousPage).toBe(false);
    expect(createPaginationResponse([], 2, 10, 30).hasPreviousPage).toBe(true);
    expect(createPaginationResponse([], 2, 10, 30).hasNextPage).toBe(true);
    expect(createPaginationResponse([], 3, 10, 30).hasNextPage).toBe(false);
    expect(createPaginationResponse([], 4, 10, 30).hasNextPage).toBe(false);
  });

  it('stores the inputs', () => {
    const r = createPaginationResponse(['a', 'b'], 2, 5, 12);
    expect(r).toMatchObject({ items: ['a', 'b'], pageNumber: 2, pageSize: 5, totalCount: 12 });
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }));

  it('returns the requested page', () => {
    const page = paginate(items, { pageNumber: 2, pageSize: 10 });
    expect(page.items.map((x) => x.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page).toMatchObject({ totalCount: 25, totalPages: 3, hasNextPage: true });
  });

  it('normalizes the request', () => {
    const page = paginate(items, { pageNumber: 0, pageSize: 500 });
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(100);
    expect(page.items).toHaveLength(25);
  });

  it('applies the search filter only for a non-empty trimmed term', () => {
    const search = (term: string) => (x: { name: string }) => x.name.endsWith(term);
    expect(
      paginate(items, { pageNumber: 1, pageSize: 10, search: ' 5 ' }, { search }).items,
    ).toEqual([items[4], items[14], items[24]]);
    expect(
      paginate(items, { pageNumber: 1, pageSize: 10, search: '  ' }, { search }).totalCount,
    ).toBe(25);
  });

  it('reports -1 when the total is not counted', () => {
    const page = paginate(items, { pageNumber: 1, pageSize: 10 }, { includeTotalCount: false });
    expect(page.totalCount).toBe(-1);
    expect(page.items).toHaveLength(10);
  });

  it('honours maxPageSize', () => {
    expect(paginate(items, { pageNumber: 1, pageSize: 20 }, { maxPageSize: 5 }).items).toHaveLength(
      5,
    );
  });
});
