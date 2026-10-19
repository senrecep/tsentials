import { isWellFormed, utf8 } from './encoding.js';

/** Construction token; not exported, so only the builders below can create a scope. */
const CONSTRUCT: unique symbol = Symbol('IdempotencyScope');

/** Reads the private storage form; assigned in the class's static block, so it stays module-private. */
let storageOf: (scope: IdempotencyScope) => string;

/**
 * JSON form of an {@link IdempotencyScope} (`toJSON`), for requests that are serialized, for
 * example queued mediator requests. `idempotencyScopes.fromJSON` turns it back into a scope.
 */
export type IdempotencyScopeJson =
  | { readonly kind: 'global' }
  | { readonly kind: 'user' | 'tenant' | 'client'; readonly value: string }
  | { readonly kind: 'custom'; readonly customKind: string; readonly value: string }
  | { readonly kind: 'userAndTenant'; readonly userId: string; readonly tenantId: string };

/**
 * Whose idempotency key it is. Only the `idempotencyScopes` builders create one, so no raw
 * string (a tenant id `global`, a user id `user:42`) can select another owner's records.
 * Immutable; `toString()` gives the storage form.
 */
export class IdempotencyScope {
  readonly #storage: string;
  readonly #json: IdempotencyScopeJson;

  /** @internal Use `idempotencyScopes`. */
  constructor(token: typeof CONSTRUCT, storage: string, json: IdempotencyScopeJson) {
    if (token !== CONSTRUCT) {
      throw new TypeError('Create an IdempotencyScope with idempotencyScopes.');
    }
    this.#storage = storage;
    this.#json = Object.freeze({ ...json });
    Object.freeze(this);
  }

  /** The builder that created this scope. */
  get kind(): IdempotencyScopeJson['kind'] {
    return this.#json.kind;
  }

  /** JSON form, read back by `idempotencyScopes.fromJSON`. */
  toJSON(): IdempotencyScopeJson {
    return this.#json;
  }

  /** Storage form: `user:42`, `9:tenant:t1/user:u1`, `global`, `kind:value`. */
  toString(): string {
    return this.#storage;
  }

  /** True for a scope created by `idempotencyScopes`. */
  static isScope(value: unknown): value is IdempotencyScope {
    return typeof value === 'object' && value !== null && #storage in value;
  }

  static {
    storageOf = (scope) => scope.#storage;
  }
}
Object.freeze(IdempotencyScope.prototype);
Object.freeze(IdempotencyScope);

/**
 * Storage form of a resolved scope. Anything other than an {@link IdempotencyScope} throws
 * `TypeError`: a raw string would let an owner id such as `global` or `user:42` share
 * another owner's records.
 */
export function scopeStorageValue(scope: unknown): string {
  if (IdempotencyScope.isScope(scope)) return storageOf(scope);
  throw new TypeError(
    typeof scope === 'string'
      ? 'A raw string is not an idempotency scope: build it with idempotencyScopes, for example idempotencyScopes.tenant(id).'
      : `An idempotency scope must come from idempotencyScopes (got ${scope === null ? 'null' : typeof scope}).`,
  );
}

const GLOBAL = new IdempotencyScope(CONSTRUCT, 'global', { kind: 'global' });

/**
 * Scope builders. A scope says whose key it is, so the same key sent by two users or two
 * tenants gives two records. Every builder returns `undefined` when its input is missing,
 * which the caller treats as "no scope" (see `unscopedKeyBehavior`).
 */
export const idempotencyScopes = {
  /** One shared scope (stored as `global`). Choose it only when keys are unique across all callers. */
  global: GLOBAL,
  /** Per authenticated user. */
  user: (userId: string | null | undefined): IdempotencyScope | undefined => single('user', userId),
  /** Per tenant. */
  tenant: (tenantId: string | null | undefined): IdempotencyScope | undefined =>
    single('tenant', tenantId),
  /**
   * Per user within a tenant; `undefined` when either is missing. The tenant part is
   * length-prefixed, so no tenant and user pair shares a scope with another.
   */
  userAndTenant(
    userId: string | null | undefined,
    tenantId: string | null | undefined,
  ): IdempotencyScope | undefined {
    if (isMissing(userId) || isMissing(tenantId)) return undefined;
    const tenant = `tenant:${tenantId}`;
    return new IdempotencyScope(CONSTRUCT, `${utf8(tenant).length}:${tenant}/user:${userId}`, {
      kind: 'userAndTenant',
      userId,
      tenantId,
    });
  },
  /** Per machine client, for API keys and client credentials. */
  client: (clientId: string | null | undefined): IdempotencyScope | undefined =>
    single('client', clientId),
  /**
   * Any other kind of owner, stored as `kind:value`. `kind` must not be a built-in kind
   * (`user`, `tenant`, `client`, `global`, in any case), contain `:` or `/`, or be all digits, so a custom
   * scope never shares the storage form of a built-in one; otherwise it throws `TypeError`.
   */
  custom(kind: string, value: string | null | undefined): IdempotencyScope | undefined {
    assertCustomKind(kind);
    if (isMissing(value)) return undefined;
    return new IdempotencyScope(CONSTRUCT, `${kind}:${value}`, {
      kind: 'custom',
      customKind: kind,
      value,
    });
  },
  /**
   * Reads a scope back from its JSON form (`IdempotencyScope.toJSON`); a scope is returned
   * as is. Anything else, including a raw string or a JSON form with a missing or empty
   * field, throws `TypeError`.
   */
  fromJSON(json: unknown): IdempotencyScope {
    if (IdempotencyScope.isScope(json)) return json;
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return invalidJson(typeof json === 'string' ? 'a raw string' : typeof json);
    }
    const proto = Object.getPrototypeOf(json);
    if (proto !== Object.prototype && proto !== null) return invalidJson('not a plain object');
    const j = json as Record<string, unknown>;
    const kind = own(j, 'kind');
    switch (kind) {
      case 'global':
        return GLOBAL;
      case 'user':
      case 'tenant':
      case 'client':
        return single(kind, field(j, 'value')) as IdempotencyScope;
      case 'custom':
        return idempotencyScopes.custom(
          field(j, 'customKind'),
          field(j, 'value'),
        ) as IdempotencyScope;
      case 'userAndTenant':
        return idempotencyScopes.userAndTenant(
          field(j, 'userId'),
          field(j, 'tenantId'),
        ) as IdempotencyScope;
      default:
        return invalidJson(`kind ${JSON.stringify(kind)}`);
    }
  },
} as const;

const BUILT_IN_KINDS: ReadonlySet<string> = new Set(['user', 'tenant', 'client', 'global']);

/** `null`, `undefined` and `''` are missing; any other non-string throws. */
function isMissing(value: string | null | undefined): value is null | undefined | '' {
  if (value == null || value === '') return true;
  if (typeof value !== 'string') {
    throw new TypeError(`An idempotency scope value must be a string (got ${typeof value}).`);
  }
  if (!isWellFormed(value)) {
    throw new TypeError('An idempotency scope value must be well-formed UTF-16.');
  }
  return false;
}

function assertCustomKind(kind: string): void {
  if (
    typeof kind !== 'string' ||
    kind === '' ||
    !isWellFormed(kind) ||
    BUILT_IN_KINDS.has(kind.toLowerCase()) ||
    /[:/]/.test(kind) ||
    /^[0-9]+$/.test(kind)
  ) {
    throw new TypeError(
      `${JSON.stringify(kind)} is not a custom idempotency scope kind: use a non-empty, well-formed name that is not user, tenant, client or global in any case, has no ':' or '/', and is not all digits.`,
    );
  }
}

function single(
  kind: 'user' | 'tenant' | 'client',
  value: string | null | undefined,
): IdempotencyScope | undefined {
  return isMissing(value)
    ? undefined
    : new IdempotencyScope(CONSTRUCT, `${kind}:${value}`, { kind, value });
}

function field(json: Record<string, unknown>, name: string): string {
  const value = own(json, name);
  if (typeof value !== 'string' || value === '') {
    return invalidJson(`${name} is not a non-empty string`);
  }
  return value;
}

/** An own field only, so a polluted `Object.prototype` cannot fill in a missing one. */
function own(json: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(json, name) ? json[name] : undefined;
}

function invalidJson(what: string): never {
  throw new TypeError(`Not an idempotency scope JSON form (${what}).`);
}
