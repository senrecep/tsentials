import { type AppError, Err, ErrorMetadata } from '../errors/index.js';
import { safeString } from '../errors/safe-string.js';
import { Result } from '../result/index.js';
import { PAGINATION_DEFAULTS } from './offset.js';

/** Value kinds a keyset key may hold. */
export type KeysetKeyKind = 'number' | 'string' | 'date' | 'bigint';

/** A decoded keyset value. */
export type KeysetValue = number | string | Date | bigint;

/** Sort direction of one keyset key. */
export type KeysetDirection = 'asc' | 'desc';

/** Which way a cursor pages: `'after'` (next page) or `'before'` (previous page). */
export type KeysetCursorDirection = 'after' | 'before';

/** One column of a {@link KeysetOrdering}. */
export interface KeysetKey<T> {
  readonly path: string;
  readonly kind: KeysetKeyKind;
  readonly direction: KeysetDirection;
  readonly get: (item: T) => unknown;
}

/**
 * An immutable, ordered list of keyset keys. Build it with
 * {@link keysetOrdering}; every `ascending` / `descending` call returns a new ordering.
 * The last key should be unique (for example the id) so that the order is total.
 */
export interface KeysetOrdering<T> {
  readonly entityName: string;
  readonly keys: readonly KeysetKey<T>[];
  /** Short hash of the ordering definition; cursors issued for another ordering are rejected. */
  readonly fingerprint: string;
  ascending(path: string, kind: KeysetKeyKind, get?: (item: T) => unknown): KeysetOrdering<T>;
  descending(path: string, kind: KeysetKeyKind, get?: (item: T) => unknown): KeysetOrdering<T>;
}

/**
 * Wraps the encoded cursor, e.g. with an HMAC or encryption.
 * `tryUnprotect` returns `undefined` when the cursor cannot be unprotected; `decodeCursor`
 * treats a throwing `tryUnprotect` the same way.
 */
export interface CursorProtector {
  protect(cursor: string): string;
  tryUnprotect(protectedCursor: string): string | undefined;
}

/** A protector that returns the cursor unchanged. */
export const noOpCursorProtector: CursorProtector = Object.freeze({
  protect: (cursor: string) => cursor,
  tryUnprotect: (protectedCursor: string) => protectedCursor,
});

/** Options of keyset paging. */
export interface KeysetPaginationOptions {
  /** Upper bound for `limit`, in `[1, 2^31 - 2]` (default 100). */
  readonly maxLimit?: number | undefined;
  /** Cursors longer than this are rejected before decoding, at least 1 (default 2048). */
  readonly maxCursorLength?: number | undefined;
  /** Default {@link noOpCursorProtector}. */
  readonly protector?: CursorProtector | undefined;
}

/** A keyset request. An empty cursor string counts as absent. */
export interface KeysetPaginationRequest {
  /** Page size (default 10), clamped to `[1, maxLimit]`. */
  readonly limit?: number | undefined;
  readonly after?: string | undefined;
  readonly before?: string | undefined;
}

/** One keyset page. */
export interface KeysetPaginationResponse<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | undefined;
  readonly previousCursor: string | undefined;
  /** `nextCursor !== undefined`. */
  readonly hasNext: boolean;
  /** `previousCursor !== undefined`. */
  readonly hasPrevious: boolean;
}

/** Defaults of {@link KeysetPaginationOptions}. */
export const KEYSET_DEFAULTS = {
  maxLimit: 100,
  maxCursorLength: 2048,
  limit: PAGINATION_DEFAULTS.limit,
} as const;

/** Error codes of keyset paging. */
export const KeysetCursorErrors = {
  parameterKey: 'parameter',
  invalidCode: 'KeysetPagination.InvalidCursor',
  unsupportedVersionCode: 'KeysetPagination.UnsupportedCursorVersion',
  directionMismatchCode: 'KeysetPagination.CursorDirectionMismatch',
  keyMismatchCode: 'KeysetPagination.CursorKeyMismatch',
  afterAndBeforeCode: 'KeysetPagination.AfterAndBefore',
  invalidKeyValueCode: 'KeysetPagination.InvalidKeyValue',

  invalid(parameter: KeysetCursorDirection): AppError {
    return create(
      KeysetCursorErrors.invalidCode,
      `The '${parameter}' cursor is malformed or has been tampered with.`,
      parameter,
    );
  },
  unsupportedVersion(parameter: KeysetCursorDirection): AppError {
    return create(
      KeysetCursorErrors.unsupportedVersionCode,
      `The '${parameter}' cursor was created by an unsupported cursor format version.`,
      parameter,
    );
  },
  directionMismatch(parameter: KeysetCursorDirection): AppError {
    return create(
      KeysetCursorErrors.directionMismatchCode,
      `The '${parameter}' cursor was issued for the other paging direction.`,
      parameter,
    );
  },
  keyMismatch(parameter: KeysetCursorDirection): AppError {
    return create(
      KeysetCursorErrors.keyMismatchCode,
      `The '${parameter}' cursor was issued for a different ordering.`,
      parameter,
    );
  },
  afterAndBefore(): AppError {
    return Err.validation(
      KeysetCursorErrors.afterAndBeforeCode,
      "Only one of the 'after' and 'before' cursors can be set.",
    );
  },
} as const;

const create = (code: string, description: string, parameter: string): AppError =>
  Err.validation(
    code,
    description,
    ErrorMetadata.fromRecord({ [KeysetCursorErrors.parameterKey]: parameter }),
  );

// ---------------------------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------------------------

const readPath =
  <T>(path: string) =>
  (item: T): unknown => {
    let current: unknown = item;
    for (const segment of path.split('.')) {
      if (current === null || current === undefined) return current;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  };

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a 64 over the UTF-8 bytes; the first 6 bytes (big-endian) base64url-encoded. */
const fingerprintOf = (definition: string): string => {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(definition)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  const bytes = new Uint8Array(6);
  for (let i = 0; i < 6; i++) bytes[i] = Number((hash >> BigInt(56 - i * 8)) & 0xffn);
  return base64UrlEncode(bytes);
};

const makeOrdering = <T>(entityName: string, keys: readonly KeysetKey<T>[]): KeysetOrdering<T> => {
  const definition = `${entityName}|${keys
    .map((k) => `${k.path}:${k.kind}:${k.direction === 'asc' ? 'a' : 'd'}`)
    .join('|')}`;
  const add = (
    path: string,
    kind: KeysetKeyKind,
    direction: KeysetDirection,
    get: ((item: T) => unknown) | undefined,
  ): KeysetOrdering<T> => {
    if (path === '') throw new TypeError('Keyset key path must not be empty. (Parameter: path)');
    if (keys.some((k) => k.path === path)) {
      throw new TypeError(`Keyset key '${path}' is already part of the ordering. (Parameter: key)`);
    }
    const key: KeysetKey<T> = Object.freeze({
      path,
      kind,
      direction,
      get: get ?? readPath<T>(path),
    });
    return makeOrdering(entityName, [...keys, key]);
  };
  return Object.freeze({
    entityName,
    keys: Object.freeze([...keys]),
    fingerprint: fingerprintOf(definition),
    ascending: (path: string, kind: KeysetKeyKind, get?: (item: T) => unknown) =>
      add(path, kind, 'asc', get),
    descending: (path: string, kind: KeysetKeyKind, get?: (item: T) => unknown) =>
      add(path, kind, 'desc', get),
  });
};

/**
 * Starts an empty keyset ordering. `entityName` names the entity in the
 * fingerprint, since TypeScript keeps no type names at runtime. Keys without a `get` read the (dot-separated) `path`.
 *
 * @example
 * const byNewest = keysetOrdering<Order>('Order')
 *   .descending('createdAt', 'date')
 *   .ascending('id', 'number');
 */
export function keysetOrdering<T>(entityName: string): KeysetOrdering<T> {
  return makeOrdering<T>(entityName, []);
}

// ---------------------------------------------------------------------------------------------
// Base64Url
// ---------------------------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function base64UrlDecode(value: string): Uint8Array | undefined {
  if (value.length === 0 || value.length % 4 === 1 || !BASE64URL.test(value)) return undefined;
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  // The checks above leave only valid, correctly padded base64, which `atob` never rejects.
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

// Year: four digits, or a sign and six digits (the expanded form `toISOString()` writes outside
// 0000-9999, e.g. `+010000` or `-000001`).
const ISO_DATE =
  /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))?)?$/;

/**
 * Parses a cursor date strictly: ISO 8601 only, and every component must be in range, so
 * `2024-02-30`, `T24:00`, a `+25:00` offset, `-000000` or an instant outside the `Date` range
 * is rejected. A value without an offset is read as UTC, never as the host's local time.
 */
const parseCursorDate = (text: string): Date | undefined => {
  const m = ISO_DATE.exec(text);
  if (!m) return undefined;
  const [, y = '', mo, d, h = '0', mi = '0', sec = '0', , zone, oh = '0', om = '0'] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(sec);
  if (
    y === '-000000' ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    Number(oh) > 23 ||
    Number(om) > 59
  ) {
    return undefined;
  }
  const fields = new Date(0);
  fields.setUTCFullYear(year, month - 1, day);
  if (
    month < 1 ||
    fields.getUTCFullYear() !== year ||
    fields.getUTCMonth() !== month - 1 ||
    fields.getUTCDate() !== day
  ) {
    return undefined;
  }
  // `new Date` reads a date-only text as UTC but an offset-less date-time as local time.
  const normalised =
    m[4] === undefined ? `${text}T00:00:00Z` : zone === undefined ? `${text}Z` : text;
  const date = new Date(normalised);
  // Valid fields can still name an instant past the `Date` range (`+275760-09-13T00:00:00.001Z`).
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
};
const INTEGER = /^-?\d+$/;

const writeValue = (kind: KeysetKeyKind, value: unknown): unknown => {
  switch (kind) {
    case 'number':
      if (typeof value !== 'number') return undefined;
      return Number.isFinite(value) ? value : String(value);
    case 'string':
      return typeof value === 'string' ? value : undefined;
    case 'date':
      return value instanceof Date && !Number.isNaN(value.getTime())
        ? value.toISOString()
        : undefined;
    case 'bigint':
      return typeof value === 'bigint' ? value.toString() : undefined;
  }
};

const readValue = (kind: KeysetKeyKind, element: unknown): KeysetValue | undefined => {
  switch (kind) {
    case 'number':
      if (typeof element === 'number') return Number.isFinite(element) ? element : undefined;
      if (element === 'NaN') return Number.NaN;
      if (element === 'Infinity') return Number.POSITIVE_INFINITY;
      if (element === '-Infinity') return Number.NEGATIVE_INFINITY;
      return undefined;
    case 'string':
      return typeof element === 'string' ? element : undefined;
    case 'date':
      return typeof element === 'string' ? parseCursorDate(element) : undefined;
    case 'bigint':
      return typeof element === 'string' && INTEGER.test(element) ? BigInt(element) : undefined;
  }
};

/** Three-way comparison per kind: NaN sorts first and equals NaN; strings compare ordinally. */
const compareValues = (kind: KeysetKeyKind, a: unknown, b: unknown): number => {
  if (kind === 'date') return compareValues('number', (a as Date).getTime(), (b as Date).getTime());
  if (kind === 'number') {
    const x = a as number;
    const y = b as number;
    if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : -1;
    if (Number.isNaN(y)) return 1;
  }
  const x = a as string | number | bigint;
  const y = b as string | number | bigint;
  return x < y ? -1 : x > y ? 1 : 0;
};

const keyValues = <T>(ordering: KeysetOrdering<T>, item: T): unknown[] =>
  ordering.keys.map((key) => {
    const value = key.get(item);
    if (value === null || value === undefined) {
      throw new TypeError(
        `Keyset key '${key.path}' evaluated to null for a row of '${ordering.entityName}'. Keyset keys must never be null.`,
      );
    }
    return value;
  });

// ---------------------------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------------------------

const CURSOR_VERSION = 1;

const encodeValues = <T>(
  ordering: KeysetOrdering<T>,
  values: readonly unknown[],
  direction: KeysetCursorDirection,
  protector: CursorProtector,
): string => {
  const payload = ordering.keys.map((key, i) => {
    const written = writeValue(key.kind, values[i]);
    if (written === undefined) {
      throw new TypeError(
        `Keyset key '${key.path}' produced a value that is not a valid '${key.kind}'.`,
      );
    }
    return written;
  });
  const json = JSON.stringify({
    v: CURSOR_VERSION,
    d: direction === 'after' ? 'a' : 'b',
    k: ordering.fingerprint,
    p: payload,
  });
  return protector.protect(base64UrlEncode(new TextEncoder().encode(json)));
};

/**
 * Creates the opaque cursor for `item`: base64url (no padding) of the
 * UTF-8 JSON `{"v":1,"d":"a"|"b","k":fingerprint,"p":[...]}`, passed through the protector.
 * Non-finite numbers are written as `"NaN"`, `"Infinity"`, `"-Infinity"`; dates as ISO strings;
 * bigints as digit strings.
 *
 * Fails with `KeysetPagination.InvalidKeyValue` when the ordering is empty or a key value is null,
 * undefined or not of its declared kind.
 */
export function encodeCursor<T>(
  ordering: KeysetOrdering<T>,
  item: T,
  direction: KeysetCursorDirection,
  protector: CursorProtector = noOpCursorProtector,
): Result<string> {
  try {
    if (ordering.keys.length === 0)
      throw new TypeError('The keyset ordering needs at least one key.');
    return Result.success(encodeValues(ordering, keyValues(ordering, item), direction, protector));
  } catch (error) {
    return Result.failure(
      Err.validation(
        KeysetCursorErrors.invalidKeyValueCode,
        error instanceof Error ? error.message : safeString(error),
      ),
    );
  }
}

/** Options of {@link decodeCursor}. */
export interface DecodeCursorOptions {
  readonly maxCursorLength?: number | undefined;
  readonly protector?: CursorProtector | undefined;
}

const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes and verifies a cursor and returns the key values in
 * ordering order. All errors are `Validation` errors whose metadata `parameter` is `direction`:
 *
 * - too long, protector rejected (returned `undefined` or threw), not base64url, not UTF-8, not JSON, not an object, `v` missing or
 *   not a number → `KeysetPagination.InvalidCursor`
 * - `v` is not `1` → `KeysetPagination.UnsupportedCursorVersion`
 * - `d` / `k` not strings or `p` not an array → `KeysetPagination.InvalidCursor`
 * - `d` is the other direction → `KeysetPagination.CursorDirectionMismatch`
 * - `k` is another ordering's fingerprint or `p` has the wrong length → `KeysetPagination.CursorKeyMismatch`
 * - a value is null or not valid for its key kind → `KeysetPagination.InvalidCursor`
 */
export function decodeCursor<T>(
  ordering: KeysetOrdering<T>,
  cursor: string,
  direction: KeysetCursorDirection,
  options: DecodeCursorOptions = {},
): Result<KeysetValue[]> {
  const invalid = Result.failure<KeysetValue[]>(KeysetCursorErrors.invalid(direction));
  const maxLength = options.maxCursorLength ?? KEYSET_DEFAULTS.maxCursorLength;
  if (cursor.length > maxLength) return invalid;

  let encoded: string | undefined;
  try {
    encoded = (options.protector ?? noOpCursorProtector).tryUnprotect(cursor);
  } catch {
    return invalid;
  }
  if (encoded === undefined) return invalid;
  const bytes = base64UrlDecode(encoded);
  if (bytes === undefined) return invalid;

  let root: unknown;
  try {
    root = JSON.parse(fatalDecoder.decode(bytes));
  } catch {
    return invalid;
  }

  if (typeof root !== 'object' || root === null || Array.isArray(root)) return invalid;
  const doc = root as Record<string, unknown>;
  const version = doc['v'];
  if (typeof version !== 'number') return invalid;
  if (version !== CURSOR_VERSION) {
    return Result.failure(KeysetCursorErrors.unsupportedVersion(direction));
  }

  const d = doc['d'];
  const k = doc['k'];
  const p = doc['p'];
  if (typeof d !== 'string' || typeof k !== 'string' || !Array.isArray(p)) return invalid;
  if (d !== (direction === 'after' ? 'a' : 'b')) {
    return Result.failure(KeysetCursorErrors.directionMismatch(direction));
  }
  if (k !== ordering.fingerprint || p.length !== ordering.keys.length) {
    return Result.failure(KeysetCursorErrors.keyMismatch(direction));
  }

  const values: KeysetValue[] = [];
  for (const [i, key] of ordering.keys.entries()) {
    const value = readValue(key.kind, p[i]);
    if (value === undefined) return invalid;
    values.push(value);
  }
  return Result.success(values);
}

// ---------------------------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------------------------

/** What a data source must fetch for one keyset page (framework-free). */
export interface KeysetPagePlan {
  /** Page size after clamping to `[1, maxLimit]`. */
  readonly limit: number;
  /** Rows to fetch: `limit + 1` (the extra row tells whether more rows exist). */
  readonly take: number;
  /** `true` for a `before` page: every key direction is inverted for filtering and sorting. */
  readonly reverse: boolean;
  readonly hasAfter: boolean;
  readonly hasBefore: boolean;
  /** Decoded cursor values; fetch only rows strictly beyond them in the (effective) order. */
  readonly cursor: readonly KeysetValue[] | undefined;
}

interface ResolvedOptions {
  readonly maxLimit: number;
  readonly maxCursorLength: number;
  readonly protector: CursorProtector;
}

const resolveOptions = (options: KeysetPaginationOptions): ResolvedOptions => {
  const maxLimit = options.maxLimit ?? KEYSET_DEFAULTS.maxLimit;
  const maxCursorLength = options.maxCursorLength ?? KEYSET_DEFAULTS.maxCursorLength;
  if (!Number.isInteger(maxLimit) || maxLimit < 1 || maxLimit > 2_147_483_646) {
    throw new RangeError('maxLimit must be an integer in [1, 2147483646]. (Parameter: maxLimit)');
  }
  if (!(maxCursorLength >= 1)) {
    throw new RangeError(
      'maxCursorLength must be greater than or equal to 1. (Parameter: maxCursorLength)',
    );
  }
  return { maxLimit, maxCursorLength, protector: options.protector ?? noOpCursorProtector };
};

const assertOrdering = <T>(ordering: KeysetOrdering<T>): void => {
  if (ordering.keys.length === 0) {
    throw new TypeError('The keyset ordering needs at least one key. (Parameter: ordering)');
  }
};

const clampLimit = (limit: number | undefined, maxLimit: number): number => {
  const value = limit === undefined || Number.isNaN(limit) ? KEYSET_DEFAULTS.limit : limit;
  return Math.min(Math.max(Math.trunc(value), 1), maxLimit);
};

/**
 * Validates the request and decodes its cursor. Use it to drive any data source: filter rows strictly
 * beyond `cursor`, sort by the ordering (inverted when `reverse`), take `take` rows, then hand them to
 * {@link createKeysetPageResponse}.
 *
 * Fails with `KeysetPagination.AfterAndBefore` when both cursors are set, or with a cursor error
 * (see {@link decodeCursor}).
 *
 * @throws TypeError when the ordering has no keys; RangeError for invalid options.
 */
export function planKeysetPage<T>(
  request: KeysetPaginationRequest,
  ordering: KeysetOrdering<T>,
  options: KeysetPaginationOptions = {},
): Result<KeysetPagePlan> {
  assertOrdering(ordering);
  const resolved = resolveOptions(options);
  const hasAfter = request.after !== undefined && request.after !== '';
  const hasBefore = request.before !== undefined && request.before !== '';
  if (hasAfter && hasBefore) return Result.failure(KeysetCursorErrors.afterAndBefore());

  const limit = clampLimit(request.limit, resolved.maxLimit);
  let cursor: KeysetValue[] | undefined;
  if (hasAfter || hasBefore) {
    const direction: KeysetCursorDirection = hasBefore ? 'before' : 'after';
    const decoded = decodeCursor(
      ordering,
      (hasBefore ? request.before : request.after) as string,
      direction,
      resolved,
    );
    if (!decoded.ok) return Result.failureFrom(decoded.errors);
    cursor = decoded.value;
  }
  return Result.success({
    limit,
    take: limit + 1,
    reverse: hasBefore,
    hasAfter,
    hasBefore,
    cursor,
  });
}

/**
 * Turns the fetched rows (at most `plan.take`, in the plan's effective order) into a page:
 * drops the extra row, restores the natural order of a
 * `before` page and issues `nextCursor` (from the last item) / `previousCursor` (from the first item).
 *
 * @throws TypeError when a key of a returned row is null or not of its declared kind.
 */
export function createKeysetPageResponse<T>(
  rows: readonly T[],
  plan: KeysetPagePlan,
  ordering: KeysetOrdering<T>,
  options: KeysetPaginationOptions = {},
): KeysetPaginationResponse<T> {
  const protector = options.protector ?? noOpCursorProtector;
  const items = rows.slice(0, plan.limit + 1);
  const hasMore = items.length > plan.limit;
  if (hasMore) items.splice(plan.limit, 1);
  if (items.length === 0) {
    return {
      items,
      nextCursor: undefined,
      previousCursor: undefined,
      hasNext: false,
      hasPrevious: false,
    };
  }
  if (plan.reverse) items.reverse();

  const hasNext = plan.hasBefore || hasMore;
  const hasPrevious = plan.hasBefore ? hasMore : plan.hasAfter;
  const cursorFor = (item: T, direction: KeysetCursorDirection): string =>
    encodeValues(ordering, keyValues(ordering, item), direction, protector);
  const nextCursor = hasNext ? cursorFor(items[items.length - 1] as T, 'after') : undefined;
  const previousCursor = hasPrevious ? cursorFor(items[0] as T, 'before') : undefined;
  return { items, nextCursor, previousCursor, hasNext, hasPrevious };
}

/**
 * Compares two key tuples in the ordering's effective order (`reverse` inverts every key):
 * negative when `a` comes first. Exposed so custom data sources can filter and sort like
 * {@link keysetPaginate}.
 */
export function compareKeyset<T>(
  ordering: KeysetOrdering<T>,
  a: readonly unknown[],
  b: readonly unknown[],
  reverse = false,
): number {
  for (const [i, key] of ordering.keys.entries()) {
    const c = compareValues(key.kind, a[i], b[i]);
    if (c !== 0) return (key.direction === 'asc') !== reverse ? c : -c;
  }
  return 0;
}

/**
 * Keyset-paginates an in-memory array. Rows strictly beyond the cursor are
 * sorted by the ordering, `limit + 1` rows are taken and the page is built by
 * {@link createKeysetPageResponse}. Strings compare ordinally (code units), unlike a database collation.
 *
 * @example
 * const page = keysetPaginate(orders, { limit: 20, after: req.after }, byNewest);
 * if (page.ok) send(page.value.items, page.value.nextCursor);
 */
export function keysetPaginate<T>(
  items: readonly T[],
  request: KeysetPaginationRequest,
  ordering: KeysetOrdering<T>,
  options: KeysetPaginationOptions = {},
): Result<KeysetPaginationResponse<T>> {
  const plan = planKeysetPage(request, ordering, options);
  if (!plan.ok) return Result.failureFrom(plan.errors);
  const { cursor, reverse, take } = plan.value;

  const keyed = items.map((item) => ({ item, keys: keyValues(ordering, item) }));
  const rows = keyed
    .filter((row) => cursor === undefined || compareKeyset(ordering, row.keys, cursor, reverse) > 0)
    .sort((x, y) => compareKeyset(ordering, x.keys, y.keys, reverse))
    .slice(0, take)
    .map((row) => row.item);
  return Result.success(createKeysetPageResponse(rows, plan.value, ordering, options));
}
