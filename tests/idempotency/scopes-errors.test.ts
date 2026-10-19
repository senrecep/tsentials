import { ErrorType } from '../../src/errors/index.js';
import {
  IdempotencyErrorCodes,
  IdempotencyScope,
  idempotencyErrors,
  idempotencyScopes,
} from '../../src/idempotency/index.js';
import { scopeStorageValue } from '../../src/idempotency/scopes.js';

const s = idempotencyScopes;
const roundTrip = (scope: IdempotencyScope | undefined) =>
  s.fromJSON(JSON.parse(JSON.stringify({ scope })).scope);

describe('idempotencyScopes', () => {
  it('builds kind:value scopes', () => {
    expect(String(s.user('42'))).toBe('user:42');
    expect(String(s.tenant('t1'))).toBe('tenant:t1');
    expect(String(s.client('c1'))).toBe('client:c1');
    expect(String(s.custom('device', 'd1'))).toBe('device:d1');
    expect(s.user('42')?.kind).toBe('user');
  });

  it('keeps an id that looks like another scope inside its own kind', () => {
    expect(String(s.tenant('user:42'))).toBe('tenant:user:42');
    expect(String(s.tenant('user:42'))).not.toBe(String(s.user('42')));
  });

  it('stores global as global, which no raw string can select', () => {
    expect(String(s.global)).toBe('global');
    expect(s.global.kind).toBe('global');
    expect(scopeStorageValue(s.global)).toBe('global');
    expect(String(s.custom('global', 'x'))).toBe('global:x');
  });

  it('rejects anything that is not a built scope', () => {
    expect(() => scopeStorageValue('global')).toThrow('A raw string is not an idempotency scope');
    expect(() => scopeStorageValue('user:42')).toThrow('A raw string is not an idempotency scope');
    expect(() => scopeStorageValue(null)).toThrow('(got null)');
    for (const bad of [0, Symbol('other'), {}, { kind: 'user', value: '42' }, undefined]) {
      expect(() => scopeStorageValue(bad)).toThrow(TypeError);
    }
    expect(IdempotencyScope.isScope(s.global)).toBe(true);
    expect(IdempotencyScope.isScope({ kind: 'global' })).toBe(false);
    expect(IdempotencyScope.isScope(null)).toBe(false);
  });

  it('cannot be constructed or changed outside the builders', () => {
    const Ctor = IdempotencyScope as unknown as new (...args: unknown[]) => IdempotencyScope;
    expect(() => new Ctor(Symbol('IdempotencyScope'), 'global', { kind: 'global' })).toThrow(
      'Create an IdempotencyScope with idempotencyScopes.',
    );
    const scope = s.user('42') as IdempotencyScope;
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.toJSON())).toBe(true);
    expect(() => {
      (scope.toJSON() as { value: string }).value = '43';
    }).toThrow(TypeError);
    expect(String(scope)).toBe('user:42');
  });

  it('length-prefixes the tenant of userAndTenant', () => {
    expect(String(s.userAndTenant('u1', 't1'))).toBe('9:tenant:t1/user:u1');
    expect(String(s.userAndTenant('u', 'é'))).toBe('9:tenant:é/user:u');
    expect(String(s.userAndTenant('b', 'a/user:x'))).not.toBe(
      String(s.userAndTenant('x/user:b', 'a')),
    );
  });

  it('returns undefined for a missing value', () => {
    expect(s.user(undefined)).toBeUndefined();
    expect(s.tenant(null)).toBeUndefined();
    expect(s.client('')).toBeUndefined();
    expect(s.custom('device', '')).toBeUndefined();
    expect(s.userAndTenant('u', undefined)).toBeUndefined();
    expect(s.userAndTenant(null, 't')).toBeUndefined();
  });
});

describe('idempotencyScopes.fromJSON', () => {
  it('round-trips every kind through JSON to the same storage form', () => {
    for (const scope of [
      s.global,
      s.user('42'),
      s.tenant('user:42'),
      s.client('c1'),
      s.custom('account', 'a:1'),
      s.userAndTenant('u1', 't1'),
    ]) {
      const back = roundTrip(scope);
      expect(back).toBeInstanceOf(IdempotencyScope);
      expect(String(back)).toBe(String(scope));
      expect(back.toJSON()).toEqual(scope?.toJSON());
    }
    expect(roundTrip(s.global)).toBe(s.global);
    expect(JSON.parse(JSON.stringify(s.userAndTenant('u1', 't1')))).toEqual({
      kind: 'userAndTenant',
      userId: 'u1',
      tenantId: 't1',
    });
    expect(JSON.parse(JSON.stringify(s.custom('account', 'a')))).toEqual({
      kind: 'custom',
      customKind: 'account',
      value: 'a',
    });
  });

  it('returns a scope as is', () => {
    const scope = s.tenant('t1') as IdempotencyScope;
    expect(s.fromJSON(scope)).toBe(scope);
  });

  it('rejects a raw string and malformed JSON forms', () => {
    expect(() => s.fromJSON('user:42')).toThrow('(a raw string)');
    expect(() => s.fromJSON('global')).toThrow('(a raw string)');
    expect(() => s.fromJSON(null)).toThrow('(object)');
    expect(() => s.fromJSON(42)).toThrow('(number)');
    expect(() => s.fromJSON([])).toThrow('(object)');
    expect(() => s.fromJSON({ kind: 'admin', value: 'x' })).toThrow('(kind "admin")');
    expect(() => s.fromJSON({})).toThrow('(kind undefined)');
    expect(() => s.fromJSON({ kind: 'user' })).toThrow('value is not a non-empty string');
    expect(() => s.fromJSON({ kind: 'tenant', value: '' })).toThrow('value is not');
    expect(() => s.fromJSON({ kind: 'client', value: 1 })).toThrow('value is not');
    expect(() => s.fromJSON({ kind: 'custom', value: 'x' })).toThrow('customKind is not');
    expect(() => s.fromJSON({ kind: 'userAndTenant', userId: 'u' })).toThrow('tenantId is not');
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
