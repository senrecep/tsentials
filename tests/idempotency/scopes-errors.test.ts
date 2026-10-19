import { ErrorType } from '../../src/errors/index.js';
import {
  IDEMPOTENCY_GLOBAL_SCOPE,
  IdempotencyErrorCodes,
  idempotencyErrors,
  idempotencyScopes,
} from '../../src/idempotency/index.js';
import { scopeStorageValue } from '../../src/idempotency/scopes.js';

describe('idempotencyScopes', () => {
  it('builds kind:value scopes', () => {
    expect(idempotencyScopes.user('u1')).toBe('user:u1');
    expect(idempotencyScopes.tenant('t1')).toBe('tenant:t1');
    expect(idempotencyScopes.client('c1')).toBe('client:c1');
    expect(idempotencyScopes.custom('device', 'd1')).toBe('device:d1');
  });

  it('makes global a symbol stored as global, which no scope string can produce', () => {
    expect(typeof idempotencyScopes.global).toBe('symbol');
    expect(idempotencyScopes.global).toBe(IDEMPOTENCY_GLOBAL_SCOPE);
    expect(scopeStorageValue(idempotencyScopes.global)).toBe('global');
    expect(() => scopeStorageValue('global')).toThrow(TypeError);
    expect(idempotencyScopes.custom('global', 'x')).toBe('global:x');
    expect(scopeStorageValue('global:x')).toBe('global:x');
    expect(scopeStorageValue('tenant:global')).toBe('tenant:global');
  });

  it('rejects a scope that is not a non-empty string', () => {
    expect(() => scopeStorageValue('')).toThrow('an empty string');
    for (const bad of [null, 0, Symbol('other'), {}]) {
      expect(() => scopeStorageValue(bad as unknown as string)).toThrow(TypeError);
    }
  });

  it('length-prefixes the tenant of userAndTenant', () => {
    expect(idempotencyScopes.userAndTenant('u1', 't1')).toBe('9:tenant:t1/user:u1');
    expect(idempotencyScopes.userAndTenant('u', 'é')).toBe('9:tenant:é/user:u');
    expect(idempotencyScopes.userAndTenant('b', 'a/user:x')).not.toBe(
      idempotencyScopes.userAndTenant('x/user:b', 'a'),
    );
  });

  it('returns undefined for a missing value', () => {
    expect(idempotencyScopes.user(undefined)).toBeUndefined();
    expect(idempotencyScopes.tenant(null)).toBeUndefined();
    expect(idempotencyScopes.client('')).toBeUndefined();
    expect(idempotencyScopes.userAndTenant('u', undefined)).toBeUndefined();
    expect(idempotencyScopes.userAndTenant(null, 't')).toBeUndefined();
  });
});

describe('idempotencyErrors', () => {
  it('maps every code to its error type', () => {
    const cases = [
      [IdempotencyErrorCodes.InFlight, ErrorType.Conflict],
      [IdempotencyErrorCodes.KeyReused, ErrorType.Validation],
      [IdempotencyErrorCodes.KeyMissing, ErrorType.Validation],
      [IdempotencyErrorCodes.KeyInvalid, ErrorType.Validation],
      [IdempotencyErrorCodes.ScopeRequired, ErrorType.Validation],
    ] as const;
    for (const [code, type] of cases) {
      const error = idempotencyErrors.forCode(code);
      expect(error.code).toBe(code);
      expect(error.type).toBe(type);
    }
  });

  it('carries retryAfterMs on InFlight only when given', () => {
    expect(idempotencyErrors.inFlight(2_000).metadata?.get('retryAfterMs')).toBe(2_000);
    expect(
      idempotencyErrors.forCode(IdempotencyErrorCodes.InFlight, 500).metadata?.get('retryAfterMs'),
    ).toBe(500);
    expect(idempotencyErrors.inFlight(null).metadata?.size ?? 0).toBe(0);
    expect(idempotencyErrors.inFlight().metadata?.size ?? 0).toBe(0);
  });
});
