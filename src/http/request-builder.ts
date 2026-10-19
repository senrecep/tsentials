import { IDEMPOTENCY_KEY_HEADER } from '../idempotency/constants.js';
import type { Result } from '../result/result.js';
import type { FetchResultInit } from './fetch-result.js';
import { fetchResult } from './fetch-result.js';
import { idempotencyKeyOrNew } from './idempotency-client.js';

/** Value accepted by {@link RequestBuilder.query}. */
export type QueryValue = string | number | boolean;

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
  #body: BodyInit | null = null;
  #jsonPayload: unknown;
  #hasJsonPayload = false;
  /** True while the Content-Type header is the one {@link json} added (not set by the caller). */
  #jsonContentType = false;
  #signal: AbortSignal | undefined;
  #timeout: number | undefined;
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
   * Sets the `Idempotency-Key` header (replacing an earlier one). Without `key` a random UUID is
   * generated now, so every `send()` of this builder (retries of one logical operation) carries
   * the same key. Start a new builder for a new operation. Read the key with
   * {@link idempotencyKeyValue}.
   * @throws TypeError when `key` is not a valid idempotency key.
   */
  idempotencyKey(key?: string): this {
    const value = idempotencyKeyOrNew(key);
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
   * record: `null`/`undefined` record values are skipped.
   */
  query(name: string, value: QueryValue): this;
  query(params: Readonly<Record<string, QueryValue | null | undefined>>): this;
  query(
    nameOrParams: string | Readonly<Record<string, QueryValue | null | undefined>>,
    value?: QueryValue,
  ): this {
    if (typeof nameOrParams === 'string') {
      this.#query.push([nameOrParams, String(value)]);
      return this;
    }
    for (const [name, v] of Object.entries(nameOrParams)) {
      if (v !== null && v !== undefined) this.#query.push([name, String(v)]);
    }
    return this;
  }

  /** Sets the request body as JSON and the `Content-Type: application/json` header. */
  json(body: unknown): this {
    this.#body = JSON.stringify(body);
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

  /** Builds the final URL string: query params are appended, existing query/hash kept as-is. */
  #buildUrl(): string {
    if (this.#query.length === 0) return this.#url;
    const hashIndex = this.#url.indexOf('#');
    const base = hashIndex === -1 ? this.#url : this.#url.slice(0, hashIndex);
    const hash = hashIndex === -1 ? '' : this.#url.slice(hashIndex);
    const params = new URLSearchParams(this.#query).toString();
    const separator = !base.includes('?')
      ? '?'
      : base.endsWith('?') || base.endsWith('&')
        ? ''
        : '&';
    return `${base}${separator}${params}${hash}`;
  }

  /** Sends the request and returns Result<T>. */
  async send<T>(): Promise<Result<T>> {
    const url = this.#buildUrl();
    const init: FetchResultInit = {
      method: this.#method,
      headers: this.#headers.map(([name, value]): [string, string] => [name, value]),
      body: this.#body,
      ...(this.#signal !== undefined && { signal: this.#signal }),
      ...(this.#timeout !== undefined && { timeout: this.#timeout }),
    };

    switch (this.#method) {
      case 'GET':
        return fetchResult.get<T>(url, init);
      case 'POST':
        return this.#hasJsonPayload
          ? fetchResult.post<T>(url, this.#jsonPayload, init)
          : fetchResult.send<T>(url, init);
      case 'PUT':
        return this.#hasJsonPayload
          ? fetchResult.put<T>(url, this.#jsonPayload, init)
          : fetchResult.send<T>(url, init);
      case 'PATCH':
        return this.#hasJsonPayload
          ? fetchResult.patch<T>(url, this.#jsonPayload, init)
          : fetchResult.send<T>(url, init);
      case 'DELETE':
        return fetchResult.send<T>(url, init);
      default:
        return fetchResult.get<T>(url, init);
    }
  }
}
