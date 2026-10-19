import { utf8 } from './encoding.js';

/**
 * Scope builders. A scope says whose key it is, so the same key sent by two users or two
 * tenants gives two records. Every builder returns `undefined` when its input is missing,
 * which the caller treats as "no scope" (see `unscopedKeyBehavior`).
 */
export const idempotencyScopes = {
  /** One shared scope. Choose it explicitly, only when keys are unique across all callers. */
  global: 'global',
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
