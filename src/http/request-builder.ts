import { Err } from '../errors/app-error.js';
import { IDEMPOTENCY_KEY_HEADER } from '../idempotency/constants.js';
import { Result } from '../result/result.js';
import type { FetchResultInit, ResponseBodyType } from './fetch-result.js';
import { fetchResult, sendJson } from './fetch-result.js';
import { type IdempotencyKeyOptions, idempotencyKeyOrNew } from './idempotency-client.js';

/**
 * Value accepted by {@link RequestBuilder.query} and {@link RequestBuilder.route}. A `Date` is sent
 * as ISO 8601 (`toISOString()`).
 */
export type QueryValue = string | number | boolean | Date;

/** @throws RangeError for an invalid `Date`. */
const formatValue = (value: QueryValue): string =>
  value instanceof Date ? value.toISOString() : String(value);

/**
 * Fluent builder for HTTP requests that returns Result<T>.
 *
 * Relative URLs (e.g. `/api/users`) are kept relative, so in browsers they resolve
 * against the page origin as with plain `fetch`.
 *
 * `send<T>()` always expects a value: on every method (DELETE included) a JSON response with
 * an empty or `null` body is a NotFound failure. Use `fetchResult.delete` for a DELETE that
 * may answer with an empty body.
 *
 * @example
 * const result = await RequestBuilder
 *   .post('https://api.example.com/users')
 *   .header('X-Api-Key', apiKey)
 *   .query('version', '2')
 *   .signal(controller.signal)
 *   .timeout(5_000)
 *   .json({ name: 'Alice', email: 'alice@example.com' })
 *   .send<User>();
 */
export class RequestBuilder {
  readonly #method: string;
  readonly #url: string;
  readonly #headers: [string, string][] = [];
  readonly #query: [string, string][] = [];
  readonly #route: [string, string | undefined][] = [];
  #body: BodyInit | null = null;
  #jsonPayload: unknown;
  #hasJsonPayload = false;
  /** True while the Content-Type header is the one {@link json} added (not set by the caller). */
  #jsonContentType = false;
  #signal: AbortSignal | undefined;
  #timeout: number | undefined;
  #responseType: ResponseBodyType | undefined;
  #idempotencyKey: string | undefined;

  private constructor(method: string, url: string | URL) {
    this.#method = method;
    this.#url = url instanceof URL ? url.href : url;
  }

  static get(url: string | URL): RequestBuilder {
    return new RequestBuilder('GET', url);
  }

  static post(url: string | URL): RequestBuilder {
    return new RequestBuilder('POST', url);
  }

  static put(url: string | URL): RequestBuilder {
    return new RequestBuilder('PUT', url);
  }

  static patch(url: string | URL): RequestBuilder {
    return new RequestBuilder('PATCH', url);
  }

  static delete(url: string | URL): RequestBuilder {
    return new RequestBuilder('DELETE', url);
  }

  /**
   * Adds a request header. Calling it again with the same (case-insensitive) name adds another
   * value (sent as a comma-separated list), it does not replace the earlier one.
   * `Content-Type` is the exception: it is single-valued, so a new one replaces the old.
   */
  header(name: string, value: string): this {
    if (name.toLowerCase() === 'content-type') {
      this.#removeContentType();
      this.#jsonContentType = false;
    }
    this.#headers.push([name, value]);
    return this;
  }

  /**
   * Sets the `Idempotency-Key` header (replacing an earlier one). Without `key` a random UUID (or
   * the result of `options.idempotencyKeyGenerator`) is generated now, so every `send()` of this
   * builder (retries of one logical operation) carries the same key. Start a new builder for a new operation. Read the key with
   * {@link idempotencyKeyValue}.
   * @throws TypeError when the key, given or generated, is not a valid idempotency key.
   */
  idempotencyKey(key?: string, options?: IdempotencyKeyOptions): this {
    const value = idempotencyKeyOrNew(key, options);
    this.#removeHeader(IDEMPOTENCY_KEY_HEADER);
    this.#headers.push([IDEMPOTENCY_KEY_HEADER, value]);
    this.#idempotencyKey = value;
    return this;
  }

  /** The key set by {@link idempotencyKey}, or `undefined`. */
  get idempotencyKeyValue(): string | undefined {
    return this.#idempotencyKey;
  }

  /** Adds several request headers (same semantics as {@link header} for each entry). */
  headers(headers: Readonly<Record<string, string>>): this {
    for (const [name, value] of Object.entries(headers)) this.header(name, value);
    return this;
  }

  /**
   * Appends query string parameters: either one `name`/`value` pair, or every entry of a
   * record: `null`/`undefined` record values are skipped. An array repeats the key once per item
   * (`tag=a&tag=b`); a `Date` is sent as ISO 8601.
   * @throws RangeError for an invalid `Date`.
   */
  query(name: string, value: QueryValue | readonly QueryValue[]): this;
  query(
    params: Readonly<Record<string, QueryValue | readonly QueryValue[] | null | undefined>>,
  ): this;
  query(
    nameOrParams:
      | string
      | Readonly<Record<string, QueryValue | readonly QueryValue[] | null | undefined>>,
    value?: QueryValue | readonly QueryValue[],
  ): this {
    const entries =
      typeof nameOrParams === 'string'
        ? [[nameOrParams, value] as const]
        : Object.entries(nameOrParams);
    for (const [name, v] of entries) {
      if (v === null || v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) this.#query.push([name, formatValue(item)]);
    }
    return this;
  }

  /**
   * Replaces every `{name}` placeholder in the URL with the URL-encoded value (`encodeURIComponent`;
   * a `Date` is sent as ISO 8601): either one `name`/`value` pair or every entry of a record.
   * `send()` resolves to a Validation failure, without sending a request, when the URL has no such
   * placeholder (`RequestBuilder.RouteParameterNotFound`) or the value is `null`/`undefined`
   * (`RequestBuilder.RouteValueRequired`). Pass the URL as a string: a `URL` object percent-encodes
   * the braces, so its placeholders are not found.
   * @throws RangeError for an invalid `Date`.
   * @example
   * await RequestBuilder.get('/users/{id}').route('id', userId).send<User>();
   */
  route(name: string, value: QueryValue): this;
  route(values: Readonly<Record<string, QueryValue>>): this;
  route(nameOrValues: string | Readonly<Record<string, QueryValue>>, value?: QueryValue): this {
    const entries =
      typeof nameOrValues === 'string'
        ? [[nameOrValues, value] as const]
        : Object.entries(nameOrValues);
    for (const [name, v] of entries) {
      this.#route.push([name, v === null || v === undefined ? undefined : formatValue(v)]);
    }
    return this;
  }

  /**
   * Sets the request body as JSON and the `Content-Type: application/json` header. The value is
   * serialized once, by `send()`; a value `JSON.stringify` rejects (cyclic object, BigInt) makes
   * `send()` resolve to a Validation failure (code `TypeError`) without sending a request.
   */
  json(body: unknown): this {
    this.#body = null;
    this.#jsonPayload = body;
    this.#hasJsonPayload = true;
    this.header('Content-Type', 'application/json');
    this.#jsonContentType = true;
    return this;
  }

  /**
   * Sets a raw body. The `Content-Type: application/json` header that an earlier {@link json} added
   * is removed (so `fetch` derives the type from the body); a `Content-Type` set with {@link header}
   * after `json()` is kept.
   */
  body(body: BodyInit): this {
    this.#body = body;
    this.#hasJsonPayload = false;
    if (this.#jsonContentType) {
      this.#removeContentType();
      this.#jsonContentType = false;
    }
    return this;
  }

  #removeContentType(): void {
    this.#removeHeader('content-type');
  }

  #removeHeader(name: string): void {
    const lower = name.toLowerCase();
    for (let i = this.#headers.length - 1; i >= 0; i--) {
      if (this.#headers[i]?.[0].toLowerCase() === lower) this.#headers.splice(i, 1);
    }
  }

  /**
   * Sets the caller's AbortSignal. Aborting it makes `send()` reject with the abort reason
   * (cancellation is not converted to an error Result).
   */
  signal(signal: AbortSignal): this {
    this.#signal = signal;
    return this;
  }

  /**
   * Sets the request timeout in milliseconds (default 30000; `0` or `Infinity` disables).
   * When it elapses `send()` resolves to a failure with code `Http.Timeout`.
   */
  timeout(ms: number): this {
    this.#timeout = ms;
    return this;
  }

  /**
   * Sets how a 2xx body is read (default `'json'`). `'text'`, `'blob'` and `'arrayBuffer'` give a
   * `string`, `Blob` or `ArrayBuffer` whatever the content type; see {@link FetchResultInit.responseType}.
   * @example
   * const csv = await RequestBuilder.get('/export.csv').responseType('text').send<string>();
   */
  responseType(type: ResponseBodyType): this {
    this.#responseType = type;
    return this;
  }

  /**
   * Builds the final URL string: route placeholders are filled, query params are appended,
   * existing query/hash kept as-is.
   */
  #buildUrl(): Result<string> {
    let url = this.#url;
    for (const [name, value] of this.#route) {
      const placeholder = `{${name}}`;
      if (!url.includes(placeholder)) {
        return Result.failure(
          Err.validation(
            'RequestBuilder.RouteParameterNotFound',
            `The URL has no '${placeholder}' placeholder.`,
          ),
        );
      }
      if (value === undefined) {
        return Result.failure(
          Err.validation(
            'RequestBuilder.RouteValueRequired',
            `The route value '${name}' cannot be null or undefined.`,
          ),
        );
      }
      url = url.replaceAll(placeholder, encodeURIComponent(value));
    }
    if (this.#query.length === 0) return Result.success(url);
    const hashIndex = url.indexOf('#');
    const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
    const params = new URLSearchParams(this.#query).toString();
    const separator = !base.includes('?')
      ? '?'
      : base.endsWith('?') || base.endsWith('&')
        ? ''
        : '&';
    return Result.success(`${base}${separator}${params}${hash}`);
  }

  /** Sends the request and returns Result<T>. */
  async send<T>(): Promise<Result<T>> {
    const built = this.#buildUrl();
    if (!built.ok) return built;
    const url = built.value;
    const init: FetchResultInit = {
      method: this.#method,
      headers: this.#headers.map(([name, value]): [string, string] => [name, value]),
      body: this.#body,
      ...(this.#signal !== undefined && { signal: this.#signal }),
      ...(this.#timeout !== undefined && { timeout: this.#timeout }),
      ...(this.#responseType !== undefined && { responseType: this.#responseType }),
    };

    return this.#hasJsonPayload
      ? sendJson<T>(this.#method, url, this.#jsonPayload, init)
      : fetchResult.send<T>(url, init);
  }
}
