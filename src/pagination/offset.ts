/** Defaults shared by the pagination helpers. */
export const PAGINATION_DEFAULTS = {
  /** Largest page size {@link normalizePaginationRequest} allows unless told otherwise. */
  maxPageSize: 100,
  /** Default limit of a cursor / keyset request. */
  limit: 10,
} as const;

const INT32_MAX = 2_147_483_647;

/** An offset (page number / page size) request. */
export interface PaginationRequest {
  readonly pageNumber?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly search?: string | undefined;
}

/** A request after {@link normalizePaginationRequest}: every field is set and in range. */
export interface NormalizedPaginationRequest {
  readonly pageNumber: number;
  readonly pageSize: number;
  readonly search?: string | undefined;
}

/** A cursor / limit request. */
export interface CursorPaginationRequest<TCursor> {
  readonly cursor?: TCursor | undefined;
  readonly limit?: number | undefined;
  readonly search?: string | undefined;
}

/** A cursor request after {@link normalizeCursorRequest}. */
export interface NormalizedCursorPaginationRequest<TCursor> {
  readonly cursor?: TCursor | undefined;
  readonly limit: number;
  readonly search?: string | undefined;
}

/** One page of an offset query. */
export interface PaginationResponse<T> {
  readonly items: readonly T[];
  readonly pageNumber: number;
  readonly pageSize: number;
  /** `-1` when the total was not counted. */
  readonly totalCount: number;
  readonly totalPages: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
}

/** Truncates to an integer: NaN and undefined become 0. */
const toInt = (value: number | undefined): number => {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.trunc(value);
};

const assertMax = (value: number, name: string): void => {
  if (!(value >= 1)) {
    throw new RangeError(`${name} must be greater than or equal to 1. (Parameter: ${name})`);
  }
};

/**
 * Returns a normalized copy of `request`: `search` is trimmed,
 * `pageNumber` is at least 1 and `pageSize` is clamped to `[1, maxPageSize]`. Missing, NaN or fractional
 * numbers are truncated to integers first (missing/NaN → 0, which then becomes 1).
 *
 * @throws RangeError when `maxPageSize` is less than 1.
 *
 * @example
 * normalizePaginationRequest({ pageNumber: 0, pageSize: 500 }) // { pageNumber: 1, pageSize: 100 }
 */
export function normalizePaginationRequest(
  request: PaginationRequest,
  maxPageSize: number = PAGINATION_DEFAULTS.maxPageSize,
): NormalizedPaginationRequest {
  assertMax(maxPageSize, 'maxPageSize');
  const max = Math.trunc(maxPageSize);
  return {
    pageNumber: Math.max(toInt(request.pageNumber), 1),
    pageSize: Math.min(Math.max(toInt(request.pageSize), 1), max),
    search: request.search?.trim(),
  };
}

/**
 * Number of rows to skip for the page:
 * `(pageNumber - 1) * pageSize`, clamped to `[0, 2^31 - 1]`.
 */
export function skipCount(request: PaginationRequest): number {
  const skip = (toInt(request.pageNumber) - 1) * toInt(request.pageSize);
  return Math.min(Math.max(skip, 0), INT32_MAX);
}

/**
 * Returns a normalized copy of a cursor request: `search` is
 * trimmed and `limit` is at least 1 (default 10), and at most `maxLimit` when given.
 *
 * @throws RangeError when `maxLimit` is given and less than 1.
 */
export function normalizeCursorRequest<TCursor>(
  request: CursorPaginationRequest<TCursor>,
  maxLimit?: number,
): NormalizedCursorPaginationRequest<TCursor> {
  if (maxLimit !== undefined) assertMax(maxLimit, 'maxLimit');
  const limit = Math.max(toInt(request.limit ?? PAGINATION_DEFAULTS.limit), 1);
  return {
    cursor: request.cursor,
    limit: maxLimit === undefined ? limit : Math.min(limit, Math.trunc(maxLimit)),
    search: request.search?.trim(),
  };
}

/**
 * Builds a page response and computes the derived fields:
 * `totalPages = pageSize === 0 ? totalCount : |ceil(totalCount / pageSize)|`,
 * `hasPreviousPage = pageNumber > 1`, `hasNextPage = pageNumber < totalPages`.
 */
export function createPaginationResponse<T>(
  items: readonly T[],
  pageNumber: number,
  pageSize: number,
  totalCount: number,
): PaginationResponse<T> {
  const totalPages = pageSize === 0 ? totalCount : Math.abs(Math.ceil(totalCount / pageSize));
  return {
    items,
    pageNumber,
    pageSize,
    totalCount,
    totalPages,
    hasPreviousPage: pageNumber > 1,
    hasNextPage: pageNumber < totalPages,
  };
}

/** Options of {@link paginate}. */
export interface PaginateOptions<T> {
  /** Filter applied when the normalized `search` is non-empty. */
  readonly search?: ((term: string) => (item: T) => boolean) | undefined;
  /** Count the filtered rows (default `true`); when `false`, `totalCount` is `-1`. */
  readonly includeTotalCount?: boolean | undefined;
  /** Upper bound for the page size (default 100). */
  readonly maxPageSize?: number | undefined;
}

/**
 * Offset-paginates an in-memory array: normalizes the request, applies `search` when the
 * trimmed term is non-empty, counts (unless `includeTotalCount` is false) and slices the page.
 *
 * @example
 * paginate(users, { pageNumber: 2, pageSize: 20 }).items
 */
export function paginate<T>(
  items: readonly T[],
  request: PaginationRequest,
  options: PaginateOptions<T> = {},
): PaginationResponse<T> {
  const normalized = normalizePaginationRequest(
    request,
    options.maxPageSize ?? PAGINATION_DEFAULTS.maxPageSize,
  );
  const term = normalized.search;
  const filtered =
    options.search !== undefined && term !== undefined && term !== ''
      ? items.filter(options.search(term))
      : items;
  const count = (options.includeTotalCount ?? true) ? filtered.length : -1;
  const skip = skipCount(normalized);
  return createPaginationResponse(
    filtered.slice(skip, skip + normalized.pageSize),
    normalized.pageNumber,
    normalized.pageSize,
    count,
  );
}
