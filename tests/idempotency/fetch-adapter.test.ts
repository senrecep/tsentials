import {
  fetchResult,
  idempotentRetryClassifier,
  withIdempotencyKey,
} from '../../src/http/index.js';
import {
  createIdempotency,
  DEFAULT_SERVER_ERROR_RETENTION_MS,
  type IdempotencyDecisionEvent,
  IdempotencyErrorCodes,
  IdempotencyEventNames,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  idempotencyScopes,
  idempotencyStorePolicies,
  type WithIdempotencyOptions,
  withIdempotency,
} from '../../src/idempotency/index.js';
import type { MediatorLogLevel } from '../../src/mediator/index.js';
import { ResiliencePolicy } from '../../src/resilience/index.js';
import { createFakeDateTimeProvider } from '../../src/time/index.js';

const URL_BASE = 'https://api.test/orders';

function post(
  key: string | null,
  body: string = '{"sku":"a"}',
  init: { url?: string; method?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(init.headers);
  if (key !== null) headers.set('Idempotency-Key', key);
  const method = init.method ?? 'POST';
  return new Request(init.url ?? URL_BASE, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });
}

interface Setup {
  handler: (request: Request) => Promise<Response>;
  runs: () => number;
  events: IdempotencyDecisionEvent[];
  logs: {
    level: MediatorLogLevel;
    message: string;
    properties: Readonly<Record<string, unknown>>;
  }[];
  store: InMemoryIdempotencyStore;
}

function setup(
  respond: (request: Request, run: number) => Response | Promise<Response>,
  options: Partial<WithIdempotencyOptions> = {},
): Setup {
  let runs = 0;
  const events: IdempotencyDecisionEvent[] = [];
  const logs: Setup['logs'] = [];
  const store = new InMemoryIdempotencyStore();
  const handler = withIdempotency(
    async (request: Request) => {
      runs += 1;
      return respond(request, runs);
    },
    {
      store,
      scope: () => idempotencyScopes.tenant('1'),
      onDecision: (e) => events.push(e),
      logger: { log: (level, message, properties) => logs.push({ level, message, properties }) },
      ...options,
    },
  );
  return { handler, runs: () => runs, events, logs, store };
}

const created = (run: number) =>
  new Response(JSON.stringify({ id: run }), {
    status: 201,
    headers: {
      'content-type': 'application/json',
      location: `/orders/${run}`,
      'set-cookie': 'session=1',
      'x-trace': `t${run}`,
    },
  });

async function problemOf(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  return (await response.json()) as Record<string, unknown>;
}

describe('withIdempotency', () => {
  it('runs once and replays the stored response with whitelisted headers', async () => {
    const s = setup((_req, run) => created(run));
    const first = await s.handler(post('k1'));
    expect(first.status).toBe(201);
    expect(first.headers.get('x-trace')).toBe('t1');
    expect(first.headers.get('idempotency-replayed')).toBeNull();
    expect(await first.json()).toEqual({ id: 1 });

    const second = await s.handler(post('k1'));
    expect(s.runs()).toBe(1);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(second.headers.get('location')).toBe('/orders/1');
    expect(second.headers.get('content-type')).toBe('application/json');
    expect(second.headers.get('set-cookie')).toBeNull();
    expect(second.headers.get('x-trace')).toBeNull();
    expect(await second.json()).toEqual({ id: 1 });
    expect(s.events.map((e) => e.decision)).toEqual(['reserved', 'stored', 'replay']);
    expect(s.events[0]).toMatchObject({ source: 'http', target: 'http', mode: 'enforce' });
  });

  it('treats a structured-field string key like the bare key', async () => {
    const s = setup((_req, run) => created(run));
    await s.handler(post('abc'));
    const replay = await s.handler(post('"abc"'));
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(s.runs()).toBe(1);
  });

  it('passes other methods and requests without a key straight through', async () => {
    const s = setup((_req, run) => created(run));
    await s.handler(post('k', '', { method: 'GET' }));
    await s.handler(post('k', '', { method: 'GET' }));
    await s.handler(post(null));
    await s.handler(post(null));
    expect(s.runs()).toBe(4);
    expect(s.events).toEqual([]);
  });

  it('guards methods case-insensitively', async () => {
    const s = setup((_req, run) => created(run), { methods: ['put', 'PATCH'] });
    await s.handler(post('k', '{}', { method: 'patch' }));
    await s.handler(post('k', '{}', { method: 'patch' }));
    await s.handler(post('k'));
    await s.handler(post('k'));
    expect(s.runs()).toBe(3);
  });

  it('passes extra handler arguments through', async () => {
    const store = new InMemoryIdempotencyStore();
    const handler = withIdempotency(
      async (_req: Request, env: { name: string }, n: number) => new Response(`${env.name}${n}`),
      { store, unscopedKeyBehavior: 'global' },
    );
    expect(await (await handler(post('k'), { name: 'w' }, 1)).text()).toBe('w1');
    expect(await (await handler(post('k'), { name: 'w' }, 2)).text()).toBe('w1');
  });

  describe('key validation', () => {
    it('answers 400 KeyMissing when a key is required', async () => {
      const s = setup((_req, run) => created(run), { requireKey: true });
      const response = await s.handler(post(null));
      expect(response.status).toBe(400);
      expect(await problemOf(response)).toMatchObject({
        status: 400,
        code: IdempotencyErrorCodes.KeyMissing,
        title: 'Missing idempotency key',
      });
      expect(s.runs()).toBe(0);
    });

    it.each([
      ['several keys', 'a, b'],
      ['an empty key', ''],
      ['a key with a quote inside', 'a"b'],
      ['a too long key', 'x'.repeat(9)],
    ])('answers 400 KeyInvalid for %s', async (_name, key) => {
      const s = setup((_req, run) => created(run), { maxKeyLength: 8 });
      const response = await s.handler(post(key));
      expect(response.status).toBe(400);
      expect(await problemOf(response)).toMatchObject({ code: IdempotencyErrorCodes.KeyInvalid });
      expect(s.runs()).toBe(0);
    });

    it('runs the handler in observe mode instead of rejecting', async () => {
      const s = setup((_req, run) => created(run), { requireKey: true, mode: 'observe' });
      expect((await s.handler(post(null))).status).toBe(201);
      expect((await s.handler(post('a, b'))).status).toBe(201);
      expect(s.runs()).toBe(2);
    });
  });

  describe('release table', () => {
    it('releases 4xx so a corrected retry runs again', async () => {
      const s = setup((_req, run) =>
        run === 1 ? new Response('bad', { status: 400 }) : created(run),
      );
      expect((await s.handler(post('k'))).status).toBe(400);
      expect((await s.handler(post('k'))).status).toBe(201);
      expect(s.runs()).toBe(2);
      expect(s.events.map((e) => e.decision)).toContain('released');
    });

    it('stores 3xx for retentionMs and 5xx for serverErrorRetentionMs', async () => {
      const store = new InMemoryIdempotencyStore();
      const complete = vi.spyOn(store, 'complete');
      const handler = withIdempotency(
        async (req: Request) =>
          new Response(null, { status: req.url.endsWith('fail') ? 500 : 303 }),
        {
          store,
          scope: () => idempotencyScopes.tenant('s'),
          retentionMs: 50_000,
          serverErrorRetentionMs: 5_000,
        },
      );
      await handler(post('a', '{}', { url: `${URL_BASE}/ok` }));
      await handler(post('b', '{}', { url: `${URL_BASE}/fail` }));
      expect(complete.mock.calls.map((c) => c[4])).toEqual([50_000, 5_000]);
      const replay = await handler(post('b', '{}', { url: `${URL_BASE}/fail` }));
      expect(replay.status).toBe(500);
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
    });

    it('keeps 503 and 504 in flight: a retry gets 409 with Retry-After', async () => {
      const s = setup(() => new Response('busy', { status: 503 }), { retryAfterMs: 1_500 });
      expect((await s.handler(post('k'))).status).toBe(503);
      const retry = await s.handler(post('k'));
      expect(retry.status).toBe(409);
      expect(retry.headers.get('retry-after')).toBe('2');
      expect(await problemOf(retry)).toMatchObject({
        status: 409,
        code: IdempotencyErrorCodes.InFlight,
        detail: expect.any(String),
      });
      expect(s.runs()).toBe(1);
    });

    it('omits Retry-After when retryAfterMs is null and rounds up to at least 1 s', async () => {
      const none = setup(() => new Response(null, { status: 504 }), { retryAfterMs: null });
      await none.handler(post('k'));
      expect((await none.handler(post('k'))).headers.get('retry-after')).toBeNull();
      const tiny = setup(() => new Response(null, { status: 504 }), { retryAfterMs: 1 });
      await tiny.handler(post('k'));
      expect((await tiny.handler(post('k'))).headers.get('retry-after')).toBe('1');
    });

    it('keeps the key in flight when the handler throws', async () => {
      const s = setup((_req, run) => {
        if (run === 1) throw new Error('boom');
        return created(run);
      });
      await expect(s.handler(post('k'))).rejects.toThrow('boom');
      expect((await s.handler(post('k'))).status).toBe(409);
    });

    it('rejects for the raw scope string global, and runs once in observe', async () => {
      const enforce = setup((_req, run) => created(run), { scope: () => 'global' as never });
      await expect(enforce.handler(post('k'))).rejects.toThrow(TypeError);
      expect(enforce.runs()).toBe(0);
      const observe = setup((_req, run) => created(run), {
        scope: () => 'global' as never,
        mode: 'observe',
      });
      expect((await observe.handler(post('k'))).status).toBe(201);
      expect((await observe.handler(post('k'))).status).toBe(201);
      expect(observe.runs()).toBe(2);
      expect(observe.logs.map((l) => l.properties.EventName)).toEqual([
        IdempotencyEventNames.ResolutionFailed,
        IdempotencyEventNames.ResolutionFailed,
      ]);
    });

    it('shares records across requests with idempotencyScopes.global', async () => {
      const s = setup((_req, run) => created(run), { scope: () => idempotencyScopes.global });
      await s.handler(post('k'));
      expect((await s.handler(post('k'))).headers.get('idempotency-replayed')).toBe('true');
      expect(s.runs()).toBe(1);
    });

    it('stores a response returned after the request was aborted', async () => {
      const controller = new AbortController();
      const store = new InMemoryIdempotencyStore();
      const handler = withIdempotency(
        async () => {
          controller.abort();
          return new Response('done', { status: 201 });
        },
        { store, unscopedKeyBehavior: 'global' },
      );
      const request = new Request(URL_BASE, {
        method: 'POST',
        body: 'x',
        headers: { 'Idempotency-Key': 'k' },
        signal: controller.signal,
      });
      expect((await handler(request)).status).toBe(201);
      const replay = await handler(post('k', 'x'));
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
    });

    it('releases everything but 2xx with successOnly', async () => {
      const s = setup(
        (_req, run) => (run === 1 ? new Response('x', { status: 500 }) : created(run)),
        { shouldStore: idempotencyStorePolicies.successOnly },
      );
      expect((await s.handler(post('k'))).status).toBe(500);
      expect((await s.handler(post('k'))).status).toBe(201);
      expect((await s.handler(post('k'))).headers.get('idempotency-replayed')).toBe('true');
      expect(idempotencyStorePolicies.successOnly(new Response(null, { status: 199 + 1 }))).toBe(
        true,
      );
    });

    it('replays a 204 with no body', async () => {
      const s = setup(() => new Response(null, { status: 204 }));
      await s.handler(post('k'));
      const replay = await s.handler(post('k'));
      expect(replay.status).toBe(204);
      expect(replay.body).toBeNull();
      expect(s.runs()).toBe(1);
    });

    it('replays an empty body', async () => {
      const s = setup(() => new Response(null, { status: 201 }));
      await s.handler(post('k'));
      const replay = await s.handler(post('k'));
      expect(await replay.text()).toBe('');
      expect(s.runs()).toBe(1);
    });

    it('stores a body exactly at the limit, read in several chunks', async () => {
      const s = setup(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2]));
                controller.enqueue(new Uint8Array([3, 4]));
                controller.close();
              },
            }),
            { status: 201 },
          ),
        { maxResponseBodyBytes: 4 },
      );
      expect(new Uint8Array(await (await s.handler(post('k'))).arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );
      const replay = await s.handler(post('k'));
      expect(new Uint8Array(await replay.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(s.runs()).toBe(1);
    });

    it('replays a large binary body byte for byte', async () => {
      const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) % 256);
      const s = setup(() => new Response(bytes, { status: 201 }));
      await s.handler(post('k'));
      const replay = await s.handler(post('k'));
      expect(new Uint8Array(await replay.arrayBuffer())).toEqual(bytes);
      expect(s.runs()).toBe(1);
    });

    const expectResultUnavailable = async (response: Response) => {
      expect(response.status).toBe(409);
      expect(response.headers.get('retry-after')).toBeNull();
      expect(response.headers.get('idempotency-replayed')).toBeNull();
      expect(await problemOf(response)).toMatchObject({
        status: 409,
        title: 'Result unavailable',
        code: IdempotencyErrorCodes.ResultUnavailable,
        detail: expect.any(String),
      });
    };

    it('sends a too large 2xx body unchanged, stores a marker and answers 409 ResultUnavailable', async () => {
      const s = setup(() => new Response('x'.repeat(10), { status: 201 }), {
        maxResponseBodyBytes: 4,
        retryAfterMs: 1_500,
      });
      const first = await s.handler(post('k'));
      expect(first.status).toBe(201);
      expect(await first.text()).toBe('x'.repeat(10));
      await expectResultUnavailable(await s.handler(post('k')));
      await expectResultUnavailable(await s.handler(post('k')));
      expect(s.runs()).toBe(1);
      expect(s.logs).toHaveLength(1);
      expect(s.logs[0]).toMatchObject({
        level: 'warning',
        properties: {
          EventName: IdempotencyEventNames.ResponseNotReplayable,
          Reason: 'too_large',
          Mode: 'enforce',
          Source: 'http',
          KeyHash: expect.any(String),
        },
      });
      expect(s.events.map((e) => e.decision)).toEqual([
        'reserved',
        'stored',
        'result_unavailable',
        'result_unavailable',
      ]);
    });

    it('logs ResponseNotReplayable only after the marker was stored', async () => {
      let logsAtComplete = -1;
      const store = new InMemoryIdempotencyStore();
      const complete = store.complete.bind(store);
      const s = setup(() => new Response('x'.repeat(10), { status: 201 }), {
        maxResponseBodyBytes: 4,
        store: Object.assign(store, {
          complete: async (...args: Parameters<typeof complete>) => {
            logsAtComplete = s.logs.length;
            return complete(...args);
          },
        }),
      });
      await s.handler(post('k'));
      expect(logsAtComplete).toBe(0);
      expect(s.logs.map((l) => l.properties.EventName)).toEqual([
        IdempotencyEventNames.ResponseNotReplayable,
      ]);
    });

    it('does not log ResponseNotReplayable when the marker could not be stored', async () => {
      const store = new InMemoryIdempotencyStore();
      const s = setup(() => new Response('x'.repeat(10), { status: 201 }), {
        maxResponseBodyBytes: 4,
        store: Object.assign(store, { complete: async () => false }),
      });
      expect((await s.handler(post('k'))).status).toBe(201);
      expect(s.logs.map((l) => l.properties.EventName)).toEqual([
        IdempotencyEventNames.ReservationLost,
      ]);
    });

    it('answers 422 KeyReused for another request with the key of a marker', async () => {
      const s = setup(() => new Response('x'.repeat(10), { status: 200 }), {
        maxResponseBodyBytes: 4,
      });
      await s.handler(post('k'));
      const reused = await s.handler(post('k', '{"sku":"other"}'));
      expect(reused.status).toBe(422);
      expect(await problemOf(reused)).toMatchObject({ code: IdempotencyErrorCodes.KeyReused });
      expect(s.runs()).toBe(1);
    });

    it.each([
      [303, 'a 3xx'],
      [500, 'a 5xx'],
    ])('keeps the key in flight for a too large %s (%s)', async (status) => {
      const s = setup(() => new Response('x'.repeat(10), { status }), {
        maxResponseBodyBytes: 4,
      });
      await s.handler(post('k'));
      const retry = await s.handler(post('k'));
      expect(retry.status).toBe(409);
      expect(await problemOf(retry)).toMatchObject({ code: IdempotencyErrorCodes.InFlight });
      expect(s.runs()).toBe(1);
      expect(s.logs.map((l) => l.properties.EventName)).toEqual([
        IdempotencyEventNames.ResponseTooLarge,
      ]);
    });

    it('releases a too large 4xx body so a corrected retry runs again', async () => {
      const s = setup(() => new Response('x'.repeat(10), { status: 400 }), {
        maxResponseBodyBytes: 4,
        shouldStore: () => true,
      });
      await s.handler(post('k'));
      await s.handler(post('k'));
      expect(s.runs()).toBe(2);
    });

    it('stores a marker for a 2xx whose Content-Length is over the limit without reading it', async () => {
      const s = setup(
        () => new Response('x', { status: 201, headers: { 'content-length': '100' } }),
        { maxResponseBodyBytes: 4 },
      );
      await s.handler(post('k'));
      await expectResultUnavailable(await s.handler(post('k')));
      expect(s.runs()).toBe(1);
    });

    it.each([
      ['an encoded body', { 'content-encoding': 'gzip' }, 'encoded'],
      ['an event stream', { 'content-type': 'text/event-stream' }, 'event_stream'],
    ])('stores a marker for a 2xx with %s', async (_name, headers, reason) => {
      const s = setup(() => new Response('x', { status: 201, headers }));
      await s.handler(post('k'));
      await expectResultUnavailable(await s.handler(post('k')));
      expect(s.runs()).toBe(1);
      expect(s.logs.map((l) => [l.properties.EventName, l.properties.Reason])).toEqual([
        [IdempotencyEventNames.ResponseNotReplayable, reason],
      ]);
    });

    it.each([
      [302, 'in flight', 409],
      [502, 'in flight', 409],
      [422, 'released', 201],
    ])('treats a %i event stream as %s', async (status, _what, retryStatus) => {
      const s = setup(
        (_req, run) =>
          run === 1
            ? new Response('x', { status, headers: { 'content-type': 'text/event-stream' } })
            : created(run),
        { shouldStore: () => true },
      );
      await s.handler(post('k'));
      expect((await s.handler(post('k'))).status).toBe(retryStatus);
    });

    it('stores an identity encoded body', async () => {
      const s = setup(
        () => new Response('x', { status: 201, headers: { 'content-encoding': ' Identity ' } }),
      );
      await s.handler(post('k'));
      await s.handler(post('k'));
      expect(s.runs()).toBe(1);
    });

    it('honours custom replayed headers and never stores Set-Cookie', async () => {
      const s = setup((_req, run) => created(run), {
        replayedHeaders: ['X-Trace', 'Set-Cookie'],
      });
      await s.handler(post('k'));
      const replay = await s.handler(post('k'));
      expect(replay.headers.get('x-trace')).toBe('t1');
      expect(replay.headers.get('set-cookie')).toBeNull();
      expect(replay.headers.get('location')).toBeNull();
    });

    it('honours custom never-store statuses', async () => {
      const s = setup(() => new Response('x', { status: 500 }), { neverStoreStatuses: [500] });
      await s.handler(post('k'));
      expect((await s.handler(post('k'))).status).toBe(409);
    });
  });

  describe('fingerprint', () => {
    it.each([
      ['another body', post('k', '{"sku":"b"}')],
      ['another query', post('k', '{"sku":"a"}', { url: `${URL_BASE}?x=1` })],
      ['another path', post('k', '{"sku":"a"}', { url: `${URL_BASE}/2` })],
      ['another method', post('k', '{"sku":"a"}', { method: 'PATCH' })],
    ])('answers 422 KeyReused for %s', async (_name, second) => {
      const s = setup((_req, run) => created(run));
      await s.handler(post('k'));
      const response = await s.handler(second);
      expect(response.status).toBe(422);
      expect(await problemOf(response)).toMatchObject({ code: IdempotencyErrorCodes.KeyReused });
    });

    it('leaves the request body readable by the handler', async () => {
      const s = setup(async (req) => new Response(await req.text(), { status: 201 }));
      expect(await (await s.handler(post('k', 'payload'))).text()).toBe('payload');
    });
  });

  describe('scope', () => {
    it('rejects a key without a scope by default and does not run the handler', async () => {
      const s = setup((_req, run) => created(run), { scope: () => undefined });
      const response = await s.handler(post('k'));
      expect(response.status).toBe(400);
      expect(await problemOf(response)).toMatchObject({
        code: IdempotencyErrorCodes.ScopeRequired,
      });
      expect(s.runs()).toBe(0);
    });

    it('runs the handler in observe mode with the default and logs the would-reject', async () => {
      const s = setup((_req, run) => created(run), { scope: () => undefined, mode: 'observe' });
      expect((await s.handler(post('k'))).status).toBe(201);
      expect(s.runs()).toBe(1);
      expect(s.events.map((e) => e.name)).toEqual([IdempotencyEventNames.WouldRejectScopeRequired]);
    });

    it('skips a key without a scope with skip and logs it', async () => {
      const s = setup((_req, run) => created(run), {
        scope: () => undefined,
        unscopedKeyBehavior: 'skip',
      });
      await s.handler(post('k'));
      await s.handler(post('k'));
      expect(s.runs()).toBe(2);
      expect(s.events.map((e) => e.name)).toEqual([
        IdempotencyEventNames.UnscopedKeySkipped,
        IdempotencyEventNames.UnscopedKeySkipped,
      ]);
    });

    it('rejects when no scope function is given, and skips with skip', async () => {
      const store = new InMemoryIdempotencyStore();
      const reserve = vi.spyOn(store, 'reserve');
      const handler = withIdempotency(async () => new Response('x'), { store });
      expect((await handler(post('k'))).status).toBe(400);
      const skipping = withIdempotency(async () => new Response('x'), {
        store,
        unscopedKeyBehavior: 'skip',
      });
      expect((await skipping(post('k'))).status).toBe(200);
      expect(reserve).not.toHaveBeenCalled();
    });

    it('answers 400 ScopeRequired with reject', async () => {
      const s = setup((_req, run) => created(run), {
        scope: () => undefined,
        unscopedKeyBehavior: 'reject',
      });
      const response = await s.handler(post('k'));
      expect(response.status).toBe(400);
      expect(await problemOf(response)).toMatchObject({
        code: IdempotencyErrorCodes.ScopeRequired,
      });
    });

    it('treats a null scope as no scope', async () => {
      const s = setup((_req, run) => created(run), {
        scope: () => null,
        unscopedKeyBehavior: 'reject',
      });
      expect((await s.handler(post('k'))).status).toBe(400);
      const skipped = setup((_req, run) => created(run), {
        scope: async () => null,
        unscopedKeyBehavior: 'skip',
      });
      await skipped.handler(post('k'));
      await skipped.handler(post('k'));
      expect(skipped.runs()).toBe(2);
    });

    it('isolates scopes and namespaces', async () => {
      let tenant = 'a';
      const s = setup((_req, run) => created(run), {
        scope: async () => idempotencyScopes.tenant(tenant),
      });
      await s.handler(post('k'));
      tenant = 'b';
      await s.handler(post('k'));
      expect(s.runs()).toBe(2);
      const other = withIdempotency(async () => new Response('other'), {
        store: s.store,
        scope: () => idempotencyScopes.tenant('b'),
        namespace: 'other',
      });
      expect(await (await other(post('k'))).text()).toBe('other');
    });
  });

  describe('stored responses that cannot be read', () => {
    const storeReturning = (payload: string): IdempotencyStore => ({
      reserve: async () => ({ status: 'completed', payload }),
      complete: async () => true,
      release: async () => true,
    });

    it.each([
      ['not JSON', '{'],
      ['no status', JSON.stringify({ headers: [], body: '' })],
      ['bad headers', JSON.stringify({ status: 200, headers: {}, body: '' })],
      ['a bad header entry', JSON.stringify({ status: 200, headers: [[1, 'x']], body: '' })],
      ['a bad header value', JSON.stringify({ status: 200, headers: [['a', 2]], body: '' })],
      ['a header that is not an array', JSON.stringify({ status: 200, headers: ['a'], body: '' })],
      ['no body', JSON.stringify({ status: 200, headers: [] })],
      ['an invalid status', JSON.stringify({ status: 99, headers: [], body: '' })],
      ['invalid base64', JSON.stringify({ status: 200, headers: [], body: '%%' })],
    ])('answers 500 without running the handler for %s', async (_name, payload) => {
      const logs: string[] = [];
      let runs = 0;
      const handler = withIdempotency(
        async () => {
          runs += 1;
          return new Response('x');
        },
        {
          store: storeReturning(payload),
          scope: () => idempotencyScopes.tenant('s'),
          logger: {
            log: (_level, _message, properties) => logs.push(String(properties.EventName)),
          },
        },
      );
      const response = await handler(post('k'));
      expect(response.status).toBe(500);
      expect(await problemOf(response)).toEqual({
        title: 'Stored response unreadable',
        status: 500,
      });
      expect(runs).toBe(0);
      expect(logs).toContain(IdempotencyEventNames.StoredResponseUnreadable);
    });

    it('ignores a disabled or throwing logger', async () => {
      for (const logger of [
        { log: () => {}, isEnabled: () => false },
        {
          log: () => {
            throw new Error('log down');
          },
        },
      ]) {
        const handler = withIdempotency(async () => new Response('x'), {
          store: storeReturning('{'),
          scope: () => idempotencyScopes.tenant('s'),
          logger,
        });
        expect((await handler(post('k'))).status).toBe(500);
      }
      const noLogger = withIdempotency(async () => new Response('x'), {
        store: storeReturning('{'),
        scope: () => idempotencyScopes.tenant('s'),
      });
      expect((await noLogger(post('k'))).status).toBe(500);
    });
  });

  describe('modes', () => {
    it('off never touches the store', async () => {
      const store = new InMemoryIdempotencyStore();
      const reserve = vi.spyOn(store, 'reserve');
      const handler = withIdempotency(async () => new Response('x'), {
        store,
        mode: 'off',
        requireKey: true,
      });
      expect((await handler(post(null))).status).toBe(200);
      expect((await handler(post('a, b'))).status).toBe(200);
      expect(reserve).not.toHaveBeenCalled();
    });

    it('observe answers like off when the request body cannot be read', async () => {
      const consumed = async () => {
        const request = post('k');
        await request.text();
        return request;
      };
      const respond = (_req: Request, run: number) => created(run);
      const off = await setup(respond, { mode: 'off' }).handler(await consumed());
      const s = setup(respond, { mode: 'observe' });
      const observed = await s.handler(await consumed());
      expect(observed.status).toBe(off.status);
      expect(await observed.text()).toBe(await off.text());
      expect(s.runs()).toBe(1);
      expect(s.events).toEqual([]);
      expect(s.logs.map((l) => l.properties.EventName)).toEqual([
        IdempotencyEventNames.ResolutionFailed,
      ]);
      await expect(setup(respond).handler(await consumed())).rejects.toThrow(TypeError);
    });

    it('observe runs every request and only reports conflicts', async () => {
      const s = setup((_req, run) => created(run), { mode: 'observe' });
      await s.handler(post('k'));
      const second = await s.handler(post('k'));
      expect(second.headers.get('idempotency-replayed')).toBeNull();
      const reused = await s.handler(post('k', '{"sku":"z"}'));
      expect(reused.status).toBe(201);
      expect(s.runs()).toBe(3);
      expect(s.events.map((e) => e.name)).toEqual([
        IdempotencyEventNames.Decision,
        IdempotencyEventNames.Decision,
        IdempotencyEventNames.WouldReplay,
        IdempotencyEventNames.WouldRejectKeyReused,
      ]);
    });
    it('observe runs the handler again for a key that holds a marker', async () => {
      const s = setup((_req, run) => new Response(`body${run}`, { status: 201 }), {
        mode: 'observe',
        maxResponseBodyBytes: 4,
      });
      await s.handler(post('k'));
      const second = await s.handler(post('k'));
      expect(second.status).toBe(201);
      expect(await second.text()).toBe('body2');
      expect(s.runs()).toBe(2);
      expect(s.events.map((e) => [e.decision, e.name])).toContainEqual([
        'result_unavailable',
        IdempotencyEventNames.WouldRejectResultUnavailable,
      ]);
      expect(s.events.map((e) => e.name)).not.toContain(IdempotencyEventNames.WouldReplay);
    });
  });

  describe('record expiry and lease end', () => {
    const clockedStore = () => {
      const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
      return { clock, store: new InMemoryIdempotencyStore({ clock }) };
    };
    const serverError = (_req: Request, run: number) => new Response(`e${run}`, { status: 500 });

    it('replays a 500 until the default serverErrorRetentionMs, then runs again', async () => {
      const { clock, store } = clockedStore();
      const s = setup(serverError, { store });
      expect((await s.handler(post('k'))).status).toBe(500);
      const replay = await s.handler(post('k'));
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
      expect(await replay.text()).toBe('e1');
      expect(s.runs()).toBe(1);
      clock.advance(DEFAULT_SERVER_ERROR_RETENTION_MS - 1);
      expect((await s.handler(post('k'))).headers.get('idempotency-replayed')).toBe('true');
      expect(s.runs()).toBe(1);
      clock.advance(2);
      const again = await s.handler(post('k'));
      expect(again.headers.get('idempotency-replayed')).toBeNull();
      expect(await again.text()).toBe('e2');
      expect(s.runs()).toBe(2);
    });

    it('takes serverErrorRetentionMs from the selected profile', async () => {
      const { clock, store } = clockedStore();
      const idem = createIdempotency({ store, profiles: { p: { serverErrorRetentionMs: 5_000 } } });
      let runs = 0;
      const handler = idem.withIdempotency(
        async () => {
          runs += 1;
          return new Response('x', { status: 500 });
        },
        { profile: 'p', unscopedKeyBehavior: 'global' },
      );
      await handler(post('k'));
      clock.advance(5_000 - 1);
      expect((await handler(post('k'))).headers.get('idempotency-replayed')).toBe('true');
      expect(runs).toBe(1);
      clock.advance(2);
      await handler(post('k'));
      expect(runs).toBe(2);
    });

    it('answers 409 ResultUnavailable until retentionMs, then runs again', async () => {
      const { clock, store } = clockedStore();
      const s = setup((_req, run) => new Response(`body${run}`, { status: 201 }), {
        store,
        retentionMs: 60_000,
        maxResponseBodyBytes: 4,
      });
      await s.handler(post('k'));
      clock.advance(60_000 - 1);
      const unavailable = await s.handler(post('k'));
      expect(unavailable.status).toBe(409);
      expect(await problemOf(unavailable)).toMatchObject({
        code: IdempotencyErrorCodes.ResultUnavailable,
      });
      expect(s.runs()).toBe(1);
      clock.advance(2);
      const again = await s.handler(post('k'));
      expect(again.status).toBe(201);
      expect(await again.text()).toBe('body2');
      expect(s.runs()).toBe(2);
    });

    const LEASE = 10_000;
    it.each([
      [
        'a handler that throws',
        async () => {
          throw new Error('boom');
        },
      ],
      [
        'a handler whose request signal aborts',
        async (_req: Request, controller: AbortController) => {
          controller.abort(new Error('client gone'));
          throw controller.signal.reason;
        },
      ],
      ['a 503 response', async () => new Response('busy', { status: 503 })],
    ])('%s: 409 with Retry-After within the lease, one more run after it', async (_name, first) => {
      const { clock, store } = clockedStore();
      const controller = new AbortController();
      const s = setup((req, run) => (run === 1 ? first(req, controller) : created(run)), {
        store,
        leaseMs: LEASE,
      });
      await s
        .handler(
          new Request(URL_BASE, {
            method: 'POST',
            body: '{"sku":"a"}',
            headers: { 'Idempotency-Key': 'k' },
            signal: controller.signal,
          }),
        )
        .catch(() => undefined);
      expect(s.runs()).toBe(1);
      clock.advance(LEASE - 1);
      const busy = await s.handler(post('k'));
      expect(busy.status).toBe(409);
      expect(busy.headers.get('retry-after')).toBe('1');
      expect(await problemOf(busy)).toMatchObject({ code: IdempotencyErrorCodes.InFlight });
      expect(s.runs()).toBe(1);
      clock.advance(2);
      expect((await s.handler(post('k'))).status).toBe(201);
      expect(s.runs()).toBe(2);
      expect((await s.handler(post('k'))).headers.get('idempotency-replayed')).toBe('true');
      expect(s.runs()).toBe(2);
    });
  });

  describe('same-key concurrency', () => {
    it('runs the handler once and answers the other 9 calls 409 InFlight', async () => {
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const s = setup(async () => {
        await gate;
        return new Response('done', { status: 201 });
      });
      let settled = 0;
      const calls = Array.from({ length: 10 }, () =>
        s.handler(post('k')).then((response) => {
          settled += 1;
          return response;
        }),
      );
      await vi.waitFor(() => expect(s.runs()).toBe(1));
      await vi.waitFor(() => expect(settled).toBe(9));
      open();
      const responses = await Promise.all(calls);
      expect(s.runs()).toBe(1);
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      const busy = responses.filter((r) => r.status === 409);
      expect(busy).toHaveLength(9);
      for (const response of busy) {
        expect(await problemOf(response)).toMatchObject({ code: IdempotencyErrorCodes.InFlight });
      }
    });
  });

  describe('setup', () => {
    it('throws without a store', () => {
      expect(() => withIdempotency(async () => new Response(), {})).toThrow(TypeError);
    });

    it.each([
      [{ maxKeyLength: 0 }],
      [{ maxResponseBodyBytes: 1.5 }],
      [{ maxResponseBodyBytes: Number.NaN }],
    ])('rejects %o', (options) => {
      expect(() =>
        withIdempotency(async () => new Response(), {
          store: new InMemoryIdempotencyStore(),
          ...options,
        }),
      ).toThrow(RangeError);
    });
  });

  describe('createIdempotency', () => {
    it('uses the defaults and the selected profile', async () => {
      const store = new InMemoryIdempotencyStore();
      const complete = vi.spyOn(store, 'complete');
      const idem = createIdempotency({
        store,
        profiles: { short: { retentionMs: 120_000 } },
      });
      const handler = idem.withIdempotency(async () => new Response('x', { status: 201 }), {
        profile: 'short',
        unscopedKeyBehavior: 'global',
      });
      await handler(post('k'));
      expect(complete.mock.calls[0]?.[4]).toBe(120_000);

      const plain = idem.withIdempotency(async () => new Response('y'), {
        unscopedKeyBehavior: 'skip',
      });
      expect(await (await plain(post('k'))).text()).toBe('y');
      expect(() => idem.withIdempotency(async () => new Response(), { profile: 'nope' })).toThrow(
        RangeError,
      );
    });
  });

  describe('with fetchResult and a retry policy', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('retries a concurrent duplicate on 409 InFlight and gets the replay', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let runs = 0;
      const server = withIdempotency(
        async () => {
          runs += 1;
          await gate;
          return Response.json({ id: 7 }, { status: 201 });
        },
        { store: new InMemoryIdempotencyStore(), unscopedKeyBehavior: 'global', retryAfterMs: 1 },
      );
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        server(new Request(input, init)),
      );

      const init = withIdempotencyKey({}, 'order-7');
      const first = fetchResult.post<{ id: number }>(URL_BASE, { sku: 'a' }, init);
      await vi.waitFor(() => expect(runs).toBe(1));

      const errors: unknown[] = [];
      const policy = ResiliencePolicy.create<{ id: number }>().withRetry({
        maxAttempts: 5,
        delay: 1,
        maxRetryAfterMs: 5,
        shouldRetry: (error) => {
          errors.push(error);
          release();
          return idempotentRetryClassifier('POST', true)(error);
        },
      });
      const second = await policy.execute(() =>
        fetchResult.post<{ id: number }>(URL_BASE, { sku: 'a' }, init),
      );

      expect(await first).toEqual({ ok: true, value: { id: 7 } });
      expect(second).toEqual({ ok: true, value: { id: 7 } });
      expect(runs).toBe(1);
      const metadata = (errors[0] as { metadata: ReadonlyMap<string, unknown> }).metadata;
      expect(metadata.get('problemCode')).toBe(IdempotencyErrorCodes.InFlight);
      expect(metadata.get('retryAfterMs')).toBe(1_000);
      expect(metadata.get('httpStatus')).toBe(409);
    });

    it('does not retry 409 ResultUnavailable', async () => {
      let runs = 0;
      const server = withIdempotency(
        async () => {
          runs += 1;
          return new Response('{"id":7}', {
            status: 201,
            headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
          });
        },
        { store: new InMemoryIdempotencyStore(), unscopedKeyBehavior: 'global' },
      );
      await server(post('order-7'));
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        server(new Request(input, init)),
      );
      const shouldRetry = vi.fn(idempotentRetryClassifier('POST', true));
      const result = await ResiliencePolicy.create()
        .withRetry({ maxAttempts: 3, delay: 0, shouldRetry })
        .execute(() => fetchResult.post(URL_BASE, { sku: 'a' }, withIdempotencyKey({}, 'order-7')));

      expect(result.ok).toBe(false);
      expect(!result.ok && result.errors[0]?.metadata?.get('problemCode')).toBe(
        IdempotencyErrorCodes.ResultUnavailable,
      );
      expect(!result.ok && result.errors[0]?.metadata?.get('retryAfterMs')).toBeUndefined();
      expect(shouldRetry).toHaveBeenCalledTimes(1);
      expect(runs).toBe(1);
    });
  });
});
