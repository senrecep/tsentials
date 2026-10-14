import type { Result } from '../result/index.js';

/** Per-call context passed to handlers and behaviors. */
export interface RequestContext {
  /** Name the request was registered under. */
  readonly requestName: string;
  /** The caller's abort signal. */
  readonly signal: AbortSignal | undefined;
}

/** Handles one request type. Must return a Result; throwing is allowed and handled by behaviors. */
export type RequestHandler<TReq, TRes> = (
  request: TReq,
  context: RequestContext,
) => Result<TRes> | Promise<Result<TRes>>;

/**
 * Continues the pipeline. Pass a request or a signal to replace
 * them for the rest of the pipeline; omitted arguments keep the current ones.
 */
export type NextHandler<TReq, TRes> = (
  request?: TReq,
  signal?: AbortSignal,
) => Promise<Result<TRes>>;

/** A pipeline behavior for one request type. */
export type Behavior<TReq, TRes> = (
  request: TReq,
  next: NextHandler<TReq, TRes>,
  context: RequestContext,
) => Result<TRes> | Promise<Result<TRes>>;

/** A behavior that works for every request type; usable as a mediator-wide behavior. */
export type GenericBehavior = <TReq, TRes>(
  request: TReq,
  next: NextHandler<TReq, TRes>,
  context: RequestContext,
) => Result<TRes> | Promise<Result<TRes>>;

/**
 * Composes a handler with behaviors. The first behavior is the outermost one: it runs first
 * and sees the final result last. The returned function always returns a promise, also when
 * the handler or a behavior throws synchronously.
 */
export function pipeline<TReq, TRes>(
  handler: RequestHandler<TReq, TRes>,
  ...behaviors: readonly Behavior<TReq, TRes>[]
): (request: TReq, context: RequestContext) => Promise<Result<TRes>> {
  const invoke = async (
    index: number,
    request: TReq,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    const behavior = behaviors[index];
    if (behavior === undefined) return handler(request, context);
    const next: NextHandler<TReq, TRes> = (nextRequest, nextSignal) =>
      invoke(
        index + 1,
        nextRequest === undefined ? request : nextRequest,
        nextSignal === undefined ? context : { ...context, signal: nextSignal },
      );
    return behavior(request, next, context);
  };
  return (request, context) => invoke(0, request, context);
}

/** Describes the requests a mediator handles: `{ GetUser: { request: GetUser; response: User } }`. */
export type RequestMap = Record<string, { readonly request: unknown; readonly response: unknown }>;

/** Options of {@link createMediator}. */
export interface MediatorOptions {
  /** Behaviors applied to every request, outermost first. They wrap the per-request behaviors. */
  readonly behaviors?: readonly GenericBehavior[] | undefined;
}

/** Options of {@link Mediator.send}. */
export interface SendOptions {
  readonly signal?: AbortSignal | undefined;
}

/** In-process request dispatcher without dependency injection. */
export interface Mediator<M extends RequestMap> {
  /**
   * Registers the handler for `name`, wrapped as: mediator-wide behaviors, then `behaviors`,
   * then the handler. Throws when `name` already has a handler.
   */
  register<N extends keyof M & string>(
    name: N,
    handler: RequestHandler<M[N]['request'], M[N]['response']>,
    ...behaviors: readonly Behavior<M[N]['request'], M[N]['response']>[]
  ): Mediator<M>;
  /** True when `name` has a registered handler. */
  has(name: keyof M & string): boolean;
  /** Sends a request through its pipeline. Rejects when no handler is registered for `name`. */
  send<N extends keyof M & string>(
    name: N,
    request: M[N]['request'],
    options?: SendOptions,
  ): Promise<Result<M[N]['response']>>;
}

/**
 * Creates a mediator.
 *
 * @example
 * type Requests = { GetUser: { request: { id: number }; response: User } };
 * const mediator = createMediator<Requests>({
 *   behaviors: [loggingBehavior({ logger }), exceptionHandlingBehavior()],
 * }).register('GetUser', (req) => repo.find(req.id), validationBehavior([idIsPositive]));
 * const user = await mediator.send('GetUser', { id: 1 }, { signal });
 */
export function createMediator<M extends RequestMap>(options: MediatorOptions = {}): Mediator<M> {
  const globalBehaviors = [...(options.behaviors ?? [])];
  const pipelines = new Map<
    string,
    (request: unknown, context: RequestContext) => Promise<Result<unknown>>
  >();

  const mediator: Mediator<M> = {
    register(name, handler, ...behaviors) {
      if (pipelines.has(name)) {
        throw new TypeError(`A handler for request '${name}' is already registered.`);
      }
      const run = pipeline(handler, ...globalBehaviors, ...behaviors);
      pipelines.set(
        name,
        run as (request: unknown, context: RequestContext) => Promise<Result<unknown>>,
      );
      return mediator;
    },
    has(name) {
      return pipelines.has(name);
    },
    send(name, request, sendOptions) {
      const run = pipelines.get(name);
      if (run === undefined) {
        return Promise.reject(new Error(`No handler registered for request '${name}'.`));
      }
      return run(request, { requestName: name, signal: sendOptions?.signal }) as Promise<
        Result<M[typeof name]['response']>
      >;
    },
  };
  return mediator;
}
