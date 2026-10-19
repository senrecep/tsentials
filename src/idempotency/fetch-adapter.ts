import type { AppError } from '../errors/index.js';
import {
  DEFAULT_MAX_KEY_LENGTH,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  type IdempotencyErrorCode,
  IdempotencyErrorCodes,
  IdempotencyEventNames,
} from './constants.js';
import { fromBase64, sha256, sha256Hex, toBase64, toHex, utf8 } from './encoding.js';
import { type IdempotencyCompletion, runIdempotent } from './engine.js';
import { idempotencyErrors } from './errors.js';
import { normalizeIdempotencyKey } from './keys.js';
import {
  type IdempotencyDefaults,
  type IdempotencySettings,
  profileOf,
  type ResolvedIdempotencySettings,
  resolveSettings,
  type UnscopedKeyBehavior,
} from './options.js';

/** Methods guarded by default. */
export const DEFAULT_IDEMPOTENT_METHODS: readonly string[] = ['POST', 'PATCH'];
/** Largest response body stored by default: 1 MiB. */
export const DEFAULT_MAX_RESPONSE_BODY_BYTES = 1_048_576;
/** Response headers stored and replayed by default. `Set-Cookie` is never stored. */
export const DEFAULT_REPLAYED_HEADERS: readonly string[] = [
  'content-type',
  'content-language',
  'location',
  'etag',
  'cache-control',
  'retry-after',
];
/** Statuses that leave the key in flight until the lease ends, instead of storing it. */
export const DEFAULT_NEVER_STORE_STATUSES: readonly number[] = [503, 504];

/** Which handler responses are stored (and replayed) instead of released. */
export const idempotencyStorePolicies = {
  /** Everything but 4xx: 2xx and 3xx for `retentionMs`, 5xx for `serverErrorRetentionMs`. */
  default: (response: Response): boolean => response.status < 400 || response.status >= 500,
  /** Only 2xx; every other response is released, so a retry runs the handler again. */
  successOnly: (response: Response): boolean => response.status >= 200 && response.status < 300,
} as const;

/** Options of {@link withIdempotency}. */
export interface WithIdempotencyOptions extends IdempotencySettings {
  /**
   * Whose key it is, normally the authenticated principal (`idempotencyScopes.user(id)`).
   * `undefined` applies `unscopedKeyBehavior`.
   */
  readonly scope?:
    | ((request: Request) => string | undefined | Promise<string | undefined>)
    | undefined;
  /** Default: `'http'`. Also the `target` of decision events. */
  readonly namespace?: string | undefined;
  /** Profile of the `createIdempotency` defaults. */
  readonly profile?: string | undefined;
  /** What a key without a scope does. Default: `skip` (logs `Idempotency.UnscopedKeySkipped`). */
  readonly unscopedKeyBehavior?: UnscopedKeyBehavior | undefined;
  /** Guarded methods (case-insensitive). Default: `POST`, `PATCH`. */
  readonly methods?: readonly string[] | undefined;
  /** A guarded request without a key gets 400 `Idempotency.KeyMissing`. Default: `false`. */
  readonly requireKey?: boolean | undefined;
  /** Longest accepted key. Default: 255. */
  readonly maxKeyLength?: number | undefined;
  /** Which responses are stored. Default: `idempotencyStorePolicies.default`. */
  readonly shouldStore?: ((response: Response) => boolean) | undefined;
  /** Responses that are neither stored nor released. Default: 503, 504. */
  readonly neverStoreStatuses?: readonly number[] | undefined;
  /** A larger response is sent unchanged, not stored, and its key released. Default: 1 MiB. */
  readonly maxResponseBodyBytes?: number | undefined;
  /** Response headers stored with the body. Default: {@link DEFAULT_REPLAYED_HEADERS}. */
  readonly replayedHeaders?: readonly string[] | undefined;
}

interface StoredResponse {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

const KEEP: IdempotencyCompletion = { action: 'keep' };
const RELEASE: IdempotencyCompletion = { action: 'release' };

const rejections: Readonly<Record<IdempotencyErrorCode, { status: number; title: string }>> = {
  [IdempotencyErrorCodes.InFlight]: { status: 409, title: 'Request in progress' },
  [IdempotencyErrorCodes.KeyReused]: { status: 422, title: 'Idempotency key reused' },
  [IdempotencyErrorCodes.KeyMissing]: { status: 400, title: 'Missing idempotency key' },
  [IdempotencyErrorCodes.KeyInvalid]: { status: 400, title: 'Invalid idempotency key' },
  [IdempotencyErrorCodes.ScopeRequired]: { status: 400, title: 'Idempotency scope required' },
};

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`withIdempotency: ${name} must be a positive integer, got ${value}`);
  }
  return value;
}

function problem(
  status: number,
  title: string,
  error: AppError | undefined,
  headers: Record<string, string> = {},
): Response {
  const body = {
    title,
    status,
    ...(error === undefined ? {} : { detail: error.description, code: error.code }),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

function rejection(code: IdempotencyErrorCode, retryAfterMs: number | null): Response {
  const { status, title } = rejections[code];
  const retryAfter =
    code === IdempotencyErrorCodes.InFlight && retryAfterMs !== null
      ? { 'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }
      : {};
  return problem(status, title, idempotencyErrors.forCode(code, retryAfterMs), retryAfter);
}

/** Method, path with query and body hash, each length-prefixed so parts cannot run together. */
async function requestFingerprint(request: Request): Promise<string> {
  const url = new URL(request.url);
  const bodyHash = toHex(await sha256(await request.clone().arrayBuffer()));
  const parts = [request.method.toUpperCase(), `${url.pathname}${url.search}`, bodyHash];
  return sha256Hex(parts.map((part) => `${utf8(part).length}:${part}`).join('|'));
}

/** The body bytes, or `undefined` once more than `limit` bytes arrive (the read is cancelled). */
async function readBody(response: Response, limit: number): Promise<Uint8Array | undefined> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) return undefined;
  const body = response.clone().body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      // Not awaited: a cancelled clone settles only once the original body is consumed too.
      reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Encoded or streamed bodies cannot be replayed byte for byte, so they are never stored. */
function isReplayable(response: Response): boolean {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  return (
    (encoding === undefined || encoding === 'identity') && !type.startsWith('text/event-stream')
  );
}

function parseStored(payload: string): StoredResponse | undefined {
  try {
    const value = JSON.parse(payload) as Partial<StoredResponse>;
    const { status, headers, body } = value;
    if (
      typeof status !== 'number' ||
      !Array.isArray(headers) ||
      !headers.every(
        (h) => Array.isArray(h) && typeof h[0] === 'string' && typeof h[1] === 'string',
      ) ||
      typeof body !== 'string'
    ) {
      return undefined;
    }
    return { status, headers, body };
  } catch {
    return undefined;
  }
}

function replayResponse(payload: string): Response | undefined {
  const stored = parseStored(payload);
  if (stored === undefined) return undefined;
  try {
    const headers = new Headers(stored.headers as [string, string][]);
    headers.set(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    const body = NULL_BODY_STATUSES.has(stored.status) ? null : fromBase64(stored.body);
    return new Response(body, { status: stored.status, headers });
  } catch {
    return undefined;
  }
}

function warn(settings: ResolvedIdempotencySettings, name: string, target: string): void {
  const { logger } = settings;
  try {
    if (logger === undefined || !(logger.isEnabled?.('warning') ?? true)) return;
    logger.log('warning', `${name} for ${target}`, { EventName: name, Target: target });
  } catch {
    // Ignored: logging is best effort.
  }
}

/** @internal Shared by `withIdempotency` and `createIdempotency`. */
export function makeWithIdempotency<A extends readonly unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options: WithIdempotencyOptions,
  defaults: IdempotencyDefaults | undefined,
): (request: Request, ...rest: A) => Promise<Response> {
  const settings = resolveSettings([options, profileOf(defaults, options.profile), defaults]);
  const namespace = options.namespace ?? 'http';
  const methods = new Set(
    (options.methods ?? DEFAULT_IDEMPOTENT_METHODS).map((m) => m.toUpperCase()),
  );
  const maxKeyLength = positiveInteger(
    'maxKeyLength',
    options.maxKeyLength ?? DEFAULT_MAX_KEY_LENGTH,
  );
  const maxBodyBytes = positiveInteger(
    'maxResponseBodyBytes',
    options.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES,
  );
  const shouldStore = options.shouldStore ?? idempotencyStorePolicies.default;
  const neverStore = new Set(options.neverStoreStatuses ?? DEFAULT_NEVER_STORE_STATUSES);
  const replayedHeaders = (options.replayedHeaders ?? DEFAULT_REPLAYED_HEADERS)
    .map((h) => h.toLowerCase())
    .filter((h) => h !== 'set-cookie');

  const complete = async (response: Response): Promise<IdempotencyCompletion> => {
    if (neverStore.has(response.status)) return KEEP;
    if (!shouldStore(response)) return RELEASE;
    // The handler did its work but the response cannot be stored: only a 4xx is released, any
    // other status keeps the key in flight so a retry cannot repeat the side effect.
    const unstorable = response.status >= 400 && response.status < 500 ? RELEASE : KEEP;
    if (!isReplayable(response)) return unstorable;
    const body = NULL_BODY_STATUSES.has(response.status)
      ? new Uint8Array(0)
      : await readBody(response, maxBodyBytes);
    if (body === undefined) {
      warn(settings, IdempotencyEventNames.ResponseTooLarge, namespace);
      return unstorable;
    }
    const headers: [string, string][] = [];
    for (const name of replayedHeaders) {
      const value = response.headers.get(name);
      if (value !== null) headers.push([name, value]);
    }
    const stored: StoredResponse = { status: response.status, headers, body: toBase64(body) };
    return {
      action: 'store',
      payload: JSON.stringify(stored),
      retentionMs: response.status >= 500 ? settings.serverErrorRetentionMs : settings.retentionMs,
    };
  };

  return async (request, ...rest) => {
    if (!methods.has(request.method.toUpperCase())) return handler(request, ...rest);
    return runIdempotent<Response>({
      settings,
      source: 'http',
      target: namespace,
      namespace,
      unscopedKeyBehavior: options.unscopedKeyBehavior ?? 'skip',
      signal: request.signal,
      key: () => {
        const raw = request.headers.get(IDEMPOTENCY_KEY_HEADER);
        if (raw === null) {
          return options.requireKey === true
            ? { reject: IdempotencyErrorCodes.KeyMissing }
            : undefined;
        }
        return (
          normalizeIdempotencyKey(raw, maxKeyLength) ?? {
            reject: IdempotencyErrorCodes.KeyInvalid,
          }
        );
      },
      scope: () => options.scope?.(request),
      fingerprint: () => requestFingerprint(request),
      run: async () => handler(request, ...rest),
      complete,
      replay: (payload) => {
        const replayed = replayResponse(payload);
        if (replayed !== undefined) return replayed;
        // Neither replayed nor run again: running it again could repeat the side effect.
        warn(settings, IdempotencyEventNames.StoredResponseUnreadable, namespace);
        return problem(500, 'Stored response unreadable', undefined);
      },
      reject: (code) => rejection(code, settings.retryAfterMs),
    });
  };
}

/**
 * Wraps a Fetch API handler (`(request: Request) => Response`, as in Hono, Workers, Deno,
 * Bun, Next.js route handlers): a `POST`/`PATCH` with an `Idempotency-Key` header runs once;
 * a retry with the same key gets the stored response with `Idempotency-Replayed: true`.
 *
 * ```ts
 * const handler = withIdempotency(createOrder, {
 *   store,
 *   scope: (req) => idempotencyScopes.user(userIdOf(req)),
 * });
 * ```
 *
 * Responses (problem+json with a top-level `code`):
 * - missing key with `requireKey` → 400 `Idempotency.KeyMissing`; malformed key, or several
 *   keys → 400 `Idempotency.KeyInvalid`;
 * - same key still running → 409 `Idempotency.InFlight` with `Retry-After`;
 * - same key with another method, path, query or body → 422 `Idempotency.KeyReused`;
 * - key without a scope and `unscopedKeyBehavior: 'reject'` → 400 `Idempotency.ScopeRequired`.
 *
 * What happens to the key after the handler returned:
 * - 2xx and 3xx → stored for `retentionMs`; 5xx → stored for `serverErrorRetentionMs`;
 * - 4xx → released, so a corrected retry with the same key runs again;
 * - 503 and 504 (`neverStoreStatuses`) → kept in flight until the lease ends;
 * - a body over `maxResponseBodyBytes`, a `Content-Encoding` or an event stream → released;
 * - the handler throws → kept in flight until the lease ends.
 *
 * The request body is buffered to hash it (Web Crypto has no streaming digest), so enforce a
 * request body size limit before this wrapper. The response body is buffered before the
 * response is returned, so do not wrap streaming routes.
 * Rate limiting, timeouts and load shedding belong outside this wrapper: their rejections
 * must not be stored. Throws at setup when no store is given or a setting is out of range.
 */
export function withIdempotency<A extends readonly unknown[]>(
  handler: (request: Request, ...rest: A) => Response | Promise<Response>,
  options: WithIdempotencyOptions,
): (request: Request, ...rest: A) => Promise<Response> {
  return makeWithIdempotency(handler, options, undefined);
}
