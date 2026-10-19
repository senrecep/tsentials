import { ErrorType } from '../../src/errors/index.js';
import {
  IdempotencyErrorCodes,
  idempotencyErrors,
  idempotencyScopes,
} from '../../src/idempotency/index.js';

describe('idempotencyScopes', () => {
  it('builds kind:value scopes', () => {
    expect(idempotencyScopes.global).toBe('global');
    expect(idempotencyScopes.user('u1')).toBe('user:u1');
    expect(idempotencyScopes.tenant('t1')).toBe('tenant:t1');
    expect(idempotencyScopes.client('c1')).toBe('client:c1');
    expect(idempotencyScopes.custom('device', 'd1')).toBe('device:d1');
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
