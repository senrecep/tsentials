import { randomUUID } from 'node:crypto';

function assertNonEmpty(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertPositive(name, value) {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

// Database time in epoch milliseconds. clock_timestamp(), not now(): now() is frozen at the start
// of a transaction, so a store that shares a long business transaction would see stale time.
const DB_NOW_MS = '(extract(epoch from clock_timestamp()) * 1000)::bigint';

/**
 * IdempotencyStore on PostgreSQL (table: see schema.sql).
 *
 * `client` is anything with `query(text, values)`: a `pg` Pool, or a PoolClient inside the
 * caller's transaction. Create the store with the transaction's client and the record commits
 * or rolls back together with the business work; with a pool each call autocommits.
 *
 * The reservation is a single atomic statement (`INSERT ... ON CONFLICT`), so parallel reserves
 * have exactly one winner; classifying a conflict re-reads the row. All time comparisons use the
 * database clock (`clock_timestamp()`), so skew between application servers does not matter.
 *
 * @implements {import('tsentials/idempotency').IdempotencyStore}
 */
export class PostgresIdempotencyStore {
  #client;
  #tokenFactory;

  /**
   * @param {{ query(text: string, values?: unknown[]): Promise<{ rows: any[], rowCount: number | null }> }} client
   * @param {{ tokenFactory?: () => string }} [options]
   */
  constructor(client, { tokenFactory } = {}) {
    this.#client = client;
    this.#tokenFactory = tokenFactory ?? (() => randomUUID());
  }

  async reserve(key, fingerprint, leaseMs, signal) {
    signal?.throwIfAborted();
    assertNonEmpty('fingerprint', fingerprint);
    assertPositive('leaseMs', leaseMs);
    const token = this.#tokenFactory();
    for (let attempt = 0; attempt < 3; attempt++) {
      const inserted = await this.#client.query(
        `INSERT INTO idempotency_records AS r (namespace, scope, key, token, fingerprint, payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, NULL, ${DB_NOW_MS} + $6::bigint)
         ON CONFLICT (namespace, scope, key) DO UPDATE
           SET token = excluded.token, fingerprint = excluded.fingerprint,
               payload = NULL, expires_at = excluded.expires_at
           WHERE r.expires_at <= ${DB_NOW_MS}
         RETURNING token`,
        [key.namespace, key.scope, key.key, token, fingerprint, Math.ceil(leaseMs)],
      );
      if (inserted.rows.length > 0) return { status: 'reserved', token: inserted.rows[0].token };
      const live = await this.#client.query(
        `SELECT fingerprint, payload FROM idempotency_records
         WHERE namespace = $1 AND scope = $2 AND key = $3 AND expires_at > ${DB_NOW_MS}`,
        [key.namespace, key.scope, key.key],
      );
      const row = live.rows[0];
      if (row === undefined) continue; // removed between the two statements: try again
      if (row.fingerprint !== fingerprint) return { status: 'mismatch' };
      return row.payload === null
        ? { status: 'inFlight' }
        : { status: 'completed', payload: row.payload };
    }
    throw new Error('Could not reserve the idempotency key: the record kept changing');
  }

  async complete(key, token, fingerprint, payload, retentionMs) {
    assertNonEmpty('token', token);
    assertNonEmpty('fingerprint', fingerprint);
    assertPositive('retentionMs', retentionMs);
    const result = await this.#client.query(
      `INSERT INTO idempotency_records AS r (namespace, scope, key, token, fingerprint, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${DB_NOW_MS} + $7::bigint)
       ON CONFLICT (namespace, scope, key) DO UPDATE
         SET fingerprint = excluded.fingerprint, payload = excluded.payload,
             expires_at = excluded.expires_at
         WHERE r.token = $4 AND r.payload IS NULL
       RETURNING 1`,
      [
        key.namespace,
        key.scope,
        key.key,
        token,
        fingerprint,
        payload,
        Math.ceil(retentionMs),
      ],
    );
    return result.rows.length === 1;
  }

  async release(key, token) {
    assertNonEmpty('token', token);
    const result = await this.#client.query(
      `DELETE FROM idempotency_records
       WHERE namespace = $1 AND scope = $2 AND key = $3 AND token = $4 AND payload IS NULL`,
      [key.namespace, key.scope, key.key, token],
    );
    return result.rowCount === 1;
  }

  async extend(key, token, leaseMs, signal) {
    signal?.throwIfAborted();
    assertNonEmpty('token', token);
    assertPositive('leaseMs', leaseMs);
    const result = await this.#client.query(
      `UPDATE idempotency_records SET expires_at = ${DB_NOW_MS} + $5::bigint
       WHERE namespace = $1 AND scope = $2 AND key = $3 AND token = $4
         AND payload IS NULL AND expires_at > ${DB_NOW_MS}
       RETURNING 1`,
      [key.namespace, key.scope, key.key, token, Math.ceil(leaseMs)],
    );
    return result.rows.length === 1;
  }
}
