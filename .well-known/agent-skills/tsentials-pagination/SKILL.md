---
name: tsentials-pagination
description: Use when paging collections — paginate() for in-memory offset paging (pageNumber/pageSize/search, PaginationResponse with totalPages and hasNextPage), keysetOrdering + keysetPaginate for stable cursor paging, and planKeysetPage/createKeysetPageResponse plus encodeCursor/decodeCursor and CursorProtector for database-backed keyset queries.
---

# tsentials/pagination

Offset paging and keyset (cursor) paging helpers. **Subpath-only:** not exported from the root `tsentials` entry.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { paginate, keysetOrdering, keysetPaginate } from 'tsentials/pagination';
import { planKeysetPage, createKeysetPageResponse, encodeCursor, decodeCursor } from 'tsentials/pagination';
import type { PaginationResponse, KeysetPaginationResponse, CursorProtector } from 'tsentials/pagination';
```

---

## Offset paging (in-memory)

```typescript
const page = paginate(users, { pageNumber: 2, pageSize: 10 });
page.items;           // readonly User[]
page.totalCount;      // number of (filtered) items
page.totalPages;
page.hasNextPage;
page.hasPreviousPage;

paginate(users, { pageNumber: 1, pageSize: 20, search: 'ann' }, {
  search: (term) => (u) => u.name.toLowerCase().includes(term.toLowerCase()),
  includeTotalCount: false,   // totalCount becomes -1
  maxPageSize: 50,            // default 100
});
```

`pageNumber` is clamped to >= 1 and `pageSize` to `[1, maxPageSize]`. Helpers for database queries: `normalizePaginationRequest(request, max?)`, `skipCount(request)`, `createPaginationResponse(items, pageNumber, pageSize, totalCount)`, `normalizeCursorRequest(request, maxLimit?)`.

## Keyset paging (in-memory)

```typescript
const byNewest = keysetOrdering<Order>('Order')
  .descending('createdAt', 'date')
  .ascending('id', 'number');       // last key must be unique

const first = keysetPaginate(orders, { limit: 10 }, byNewest);   // Result<KeysetPaginationResponse<Order>>
if (first.ok) {
  first.value.items;
  first.value.nextCursor;           // string | undefined
  first.value.hasNext;

  const next = keysetPaginate(orders, { limit: 10, after: first.value.nextCursor }, byNewest);
  // backwards: { before: cursor }
}
```

Key kinds: `'number' | 'string' | 'date' | 'bigint'`. Pass a third argument to `ascending/descending` as a custom accessor when the path is not a plain property.

### Errors (failure codes)

| Code | Cause |
|------|-------|
| `KeysetPagination.InvalidCursor` | malformed or tampered cursor |
| `KeysetPagination.AfterAndBefore` | both `after` and `before` set |
| `KeysetPagination.CursorDirectionMismatch` / `CursorKeyMismatch` | cursor issued for another direction or ordering |
| `KeysetPagination.UnsupportedCursorVersion` | unknown cursor format version |

## Database-backed keyset

```typescript
const plan = planKeysetPage({ limit: 20, after }, byNewest);
if (!plan.ok) return plan;
// Query: rows strictly beyond plan.value.cursor, sorted by the ordering (inverted when plan.value.reverse),
// LIMIT plan.value.take (limit + 1)
const rows = await db.fetch(plan.value);
const response = createKeysetPageResponse(rows, plan.value, byNewest);
```

Cursor protection (for example HMAC signing): implement `CursorProtector` (`protect`, `tryUnprotect`) and pass it as `{ protector }` in the keyset options. `encodeCursor` / `decodeCursor` are exported for custom flows.

---

## Patterns and pitfalls

- Import from `tsentials/pagination` — never from the root `tsentials` entry.
- Offset helpers never throw on out-of-range input (they clamp); keyset helpers return `Result` failures for bad cursors.
- Cursors are bound to the ordering fingerprint: changing the ordering invalidates existing cursors.
- The last key of a `keysetOrdering` must be unique (typically `id`), otherwise rows can be skipped or repeated.
- `limit` is clamped to `maxLimit` (default 100, `KEYSET_DEFAULTS`).
- In-memory string keys compare ordinally, unlike a database collation.
