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
  });

  it('rejects custom kinds that could share a built-in storage form', () => {
    for (const kind of [
      'user',
      'User',
      'GLOBAL',
      'tenant',
      'client',
      'global',
      '',
      '12',
      'a:b',
      'a/b',
      '\uD800',
      3 as never,
    ]) {
      expect(() => s.custom(kind, 'x')).toThrow('is not a custom idempotency scope kind');
    }
    expect(() => s.custom('user', undefined)).toThrow('is not a custom idempotency scope kind');
    expect(String(s.custom('account', 'b:c'))).toBe('account:b:c');
    expect(String(s.custom('v2', 'x'))).toBe('v2:x');
  });

  it('keeps an all-digit custom kind from forging a userAndTenant scope', () => {
    expect(String(s.userAndTenant('u1', 't1'))).toBe('9:tenant:t1/user:u1');
    expect(() => s.custom('9', 'tenant:t1/user:u1')).toThrow(
      'is not a custom idempotency scope kind',
    );
    expect(() => s.custom('', 'x')).toThrow('is not a custom idempotency scope kind');
    expect(() => s.custom('a:b', 'c')).toThrow('is not a custom idempotency scope kind');
  });

  it('rejects scope values that are not strings', () => {
    expect(() => s.user(42 as never)).toThrow('must be a string (got number)');
    expect(() => s.userAndTenant('u', {} as never)).toThrow(TypeError);
    expect(() => s.custom('account', true as never)).toThrow(TypeError);
    expect(() => s.tenant('\uD800')).toThrow('well-formed UTF-16');
    expect(() => s.userAndTenant('\uDC00', 't')).toThrow('well-formed UTF-16');
    expect(String(s.tenant('\uFFFD'))).toBe('tenant:\uFFFD');
  });

  it('reads the storage form from the scope itself, not from a lookalike', () => {
    const real = s.user('42') as IdempotencyScope;
    expect(Object.isFrozen(IdempotencyScope.prototype)).toBe(true);
    expect(Object.isFrozen(IdempotencyScope)).toBe(true);
    expect(() => {
      (IdempotencyScope.prototype as { toString: () => string }).toString = () => 'global';
    }).toThrow(TypeError);
    expect(scopeStorageValue(real)).toBe('user:42');
    expect(() => scopeStorageValue(Object.create(real))).toThrow(TypeError);
    expect(() => scopeStorageValue(new Proxy(real, {}))).toThrow(TypeError);
    expect(() => scopeStorageValue(structuredClone(real))).toThrow(TypeError);
    expect(() => scopeStorageValue({ toString: () => 'user:42' })).toThrow(TypeError);
    class Fake extends (IdempotencyScope as unknown as new () => object) {}
    expect(() => new Fake()).toThrow('Create an IdempotencyScope with idempotencyScopes.');
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
    expect(() => s.fromJSON({ kind: 'custom', customKind: 'user', value: '42' })).toThrow(
      'is not a custom idempotency scope kind',
    );
  });

  it('reads only own fields of a plain object', () => {
    expect(
      String(s.fromJSON(Object.assign(Object.create(null), { kind: 'user', value: '1' }))),
    ).toBe('user:1');
    expect(() => s.fromJSON(Object.create({ kind: 'global' }))).toThrow('(not a plain object)');
    expect(() => s.fromJSON(new Date())).toThrow('(not a plain object)');
    const proto = Object.prototype as { kind?: string; tenantId?: string };
    proto.kind = 'global';
    proto.tenantId = 't1';
    try {
      expect(() => s.fromJSON({})).toThrow('(kind undefined)');
      expect(() => s.fromJSON({ kind: 'userAndTenant', userId: 'u' })).toThrow('tenantId is not');
    } finally {
      delete proto.kind;
      delete proto.tenantId;
    }
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
