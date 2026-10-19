-- One row per idempotency record. expires_at is epoch milliseconds: the lease end while
-- payload is NULL (in flight), the retention end once the payload is stored.
CREATE TABLE IF NOT EXISTS idempotency_records (
  namespace   text   NOT NULL,
  scope       text   NOT NULL,
  key         text   NOT NULL,
  token       text   NOT NULL,
  fingerprint text   NOT NULL,
  payload     text   NULL,
  expires_at  bigint NOT NULL,
  PRIMARY KEY (namespace, scope, key)
);

-- Speeds up the cleanup below.
CREATE INDEX IF NOT EXISTS idempotency_records_expires_at_idx
  ON idempotency_records (expires_at);

-- Cleanup (run periodically; $1 = current epoch milliseconds). Expired rows are already
-- ignored and replaced by the store, so this only reclaims space:
-- DELETE FROM idempotency_records WHERE expires_at <= $1;
