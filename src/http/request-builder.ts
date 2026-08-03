import type { Result } from '../result/result.js';
import { fetchResult } from './fetch-result.js';

/**
 * Fluent builder for HTTP requests that returns Result<T>.
 *
 * @example
 * const result = await RequestBuilder
 *   .post('https://api.example.com/users')
 *   .header('X-Api-Key', apiKey)
 *   .query('version', '2')
 *   .json({ name: 'Alice', email: 'alice@example.com' })
 *   .send<User>();
 */
export class RequestBuilder {
  readonly #method: string;
  readonly #url: URL;
  readonly #headers: Record<string, string> = {};
  readonly #query: URLSearchParams;
  #body: BodyInit | null = null;
  #jsonPayload: unknown;
  #hasJsonPayload = false;

  private constructor(method: string, url: string | URL) {
    this.#method = method;
    this.#url = url instanceof URL ? url : new URL(url, 'http://localhost');
    this.#query = new URLSearchParams(this.#url.search);
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

  /** Adds a request header. */
  header(name: string, value: string): this {
    this.#headers[name] = value;
    return this;
  }

  /** Appends a query string parameter. */
  query(name: string, value: string): this {
    this.#query.append(name, value);
    return this;
  }

  /** Sets the request body as JSON and adds Content-Type header. */
  json(body: unknown): this {
    this.#body = JSON.stringify(body);
    this.#jsonPayload = body;
    this.#hasJsonPayload = true;
    this.#headers['Content-Type'] = 'application/json';
    return this;
  }

  /** Sets a raw body. */
  body(body: BodyInit): this {
    this.#body = body;
    this.#hasJsonPayload = false;
    return this;
  }

  /** Sends the request and returns Result<T>. */
  async send<T>(): Promise<Result<T>> {
    this.#url.search = this.#query.toString();

    const init: RequestInit = {
      method: this.#method,
      headers: this.#headers,
      body: this.#body,
    };

    switch (this.#method) {
      case 'GET':
        return fetchResult.get<T>(this.#url, init);
      case 'POST':
        return this.#hasJsonPayload
          ? fetchResult.post<T>(this.#url, this.#jsonPayload, init)
          : fetchResult.send<T>(this.#url, init);
      case 'PUT':
        return this.#hasJsonPayload
          ? fetchResult.put<T>(this.#url, this.#jsonPayload, init)
          : fetchResult.send<T>(this.#url, init);
      case 'PATCH':
        return this.#hasJsonPayload
          ? fetchResult.patch<T>(this.#url, this.#jsonPayload, init)
          : fetchResult.send<T>(this.#url, init);
      case 'DELETE':
        return fetchResult.delete<T>(this.#url, init);
      default:
        return fetchResult.get<T>(this.#url, init);
    }
  }
}
