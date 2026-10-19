import { utf8 } from './encoding.js';

/**
 * The shared scope (`idempotencyScopes.global`). A symbol, so no value read from a request,
 * a token or a database can select it: only code that names it can.
 */
export const IDEMPOTENCY_GLOBAL_SCOPE: unique symbol = Symbol.for(
  'tsentials.idempotency.globalScope',
);

/** Type of {@link IDEMPOTENCY_GLOBAL_SCOPE}. */
export type IdempotencyGlobalScope = typeof IDEMPOTENCY_GLOBAL_SCOPE;

/** What a scope resolver returns: a scope string or the shared scope. */
export type IdempotencyScope = string | IdempotencyGlobalScope;

/** Storage form of the shared scope; reserved, so a resolver cannot return it as a string. */
const GLOBAL_SCOPE_STORAGE = 'global';

/**
 * Storage form of a resolved scope. The raw string `'global'` throws `TypeError`: it would
 * share records with the global scope (for example a tenant whose id is `global`). A value that
 * is not a non-empty string (from untyped code) throws `TypeError` too.
 */
export function scopeStorageValue(scope: IdempotencyScope): string {
  if (scope === IDEMPOTENCY_GLOBAL_SCOPE) return GLOBAL_SCOPE_STORAGE;
  if (scope === GLOBAL_SCOPE_STORAGE) {
    throw new TypeError(
      "The idempotency scope 'global' is reserved: return idempotencyScopes.global for the shared scope, or a prefixed scope such as idempotencyScopes.tenant(id).",
    );
  }
  if (typeof scope !== 'string' || scope === '') {
    throw new TypeError(
      `An idempotency scope must be a non-empty string or idempotencyScopes.global (got ${typeof scope === 'string' ? 'an empty string' : typeof scope}).`,
    );
  }
  return scope;
}

/**
 * Scope builders. A scope says whose key it is, so the same key sent by two users or two
 * tenants gives two records. Every builder returns `undefined` when its input is missing,
 * which the caller treats as "no scope" (see `unscopedKeyBehavior`).
 */
export const idempotencyScopes = {
  /**
   * One shared scope (stored as `global`). Choose it explicitly, only when keys are unique
   * across all callers; a resolver that returns the string `'global'` throws instead.
   */
  global: IDEMPOTENCY_GLOBAL_SCOPE,
  /** Per authenticated user. */
  user: (userId: string | null | undefined): string | undefined => part('user', userId),
  /** Per tenant. */
  tenant: (tenantId: string | null | undefined): string | undefined => part('tenant', tenantId),
  /**
   * Per user within a tenant; `undefined` when either is missing. The tenant part is
   * length-prefixed, so no tenant and user pair shares a scope with another.
   */
  userAndTenant(
    userId: string | null | undefined,
    tenantId: string | null | undefined,
  ): string | undefined {
    const tenant = part('tenant', tenantId);
    const user = part('user', userId);
    return tenant === undefined || user === undefined
      ? undefined
      : `${utf8(tenant).length}:${tenant}/${user}`;
  },
  /** Per machine client, for API keys and client credentials. */
  client: (clientId: string | null | undefined): string | undefined => part('client', clientId),
  /** Any other kind of owner, written as `kind:value`. */
  custom: (kind: string, value: string | null | undefined): string | undefined => part(kind, value),
} as const;

function part(kind: string, value: string | null | undefined): string | undefined {
  return value == null || value === '' ? undefined : `${kind}:${value}`;
}
