import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdempotencyErrorCodes,
} from '../../src/http/index.js';

describe('idempotency constants on tsentials/http', () => {
  it('uses the standard header names', () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe('Idempotency-Key');
    expect(IDEMPOTENCY_REPLAYED_HEADER).toBe('Idempotency-Replayed');
  });

  it('exposes the error codes clients classify on', () => {
    expect(IdempotencyErrorCodes).toEqual({
      InFlight: 'Idempotency.InFlight',
      KeyReused: 'Idempotency.KeyReused',
      KeyMissing: 'Idempotency.KeyMissing',
      KeyInvalid: 'Idempotency.KeyInvalid',
      ScopeRequired: 'Idempotency.ScopeRequired',
      ResultUnavailable: 'Idempotency.ResultUnavailable',
    });
  });
});
