import {
  type IdempotencyDecisionEvent,
  IdempotencyErrorCodes,
  IdempotencyEventNames,
  type IdempotencyMode,
  type IdempotencyScope,
  type IdempotencySource,
  InMemoryIdempotencyStore,
  idempotencyBehavior,
  idempotencyScopes,
  idempotent,
  type UnscopedKeyBehavior,
  withIdempotency,
} from '../../src/idempotency/index.js';
import { createMediator } from '../../src/mediator/index.js';
import { Result } from '../../src/result/index.js';

/** One call: key, payload (part of the fingerprint) and scope (`undefined` = unscoped). */
interface Call {
  readonly key: string;
  readonly payload: string;
  readonly scope?: string | undefined;
}

/** What the caller sees, comparable across modes. */
type Outcome = unknown;

interface Driver {
  readonly source: IdempotencySource;
  send(call: Call): Promise<Outcome>;
  /** The handler of the next run waits until the returned function is called. */
  hold(): () => void;
  /** The handler has started this many runs. */
  runs(): number;
  setMode(mode: IdempotencyMode): void;
  events: IdempotencyDecisionEvent[];
  store: InMemoryIdempotencyStore;
  log: ReturnType<typeof vi.fn>;
}

type DriverFactory = (unscoped: UnscopedKeyBehavior) => Driver;

function handlerState() {
  let runs = 0;
  let gate: Promise<void> | undefined;
  return {
    runs: () => runs,
    hold: () => {
      let open: () => void = () => {};
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return open;
    },
    async run(payload: string): Promise<string> {
      runs += 1;
      const current = gate;
      gate = undefined;
      if (current !== undefined) await current;
      return `${payload}#${runs}`;
    },
  };
}

function common() {
  let mode: IdempotencyMode = 'enforce';
  const events: IdempotencyDecisionEvent[] = [];
  const store = new InMemoryIdempotencyStore();
  const log = vi.fn();
  return {
    events,
    store,
    log,
    setMode: (next: IdempotencyMode) => {
      mode = next;
    },
    settings: {
      store,
      mode: () => mode,
      onDecision: (e: IdempotencyDecisionEvent) => events.push(e),
      logger: { log },
    },
  };
}

const resultOutcome = (result: Result<string>): Outcome =>
  result.ok ? { ok: result.value } : { codes: result.errors.map((e) => e.code) };

const drivers: Record<string, DriverFactory> = {
  idempotent: (unscopedKeyBehavior) => {
    const c = common();
    const h = handlerState();
    const fn = idempotent(async (call: Call) => Result.success(await h.run(call.payload)), {
      ...c.settings,
      namespace: 'orders',
      key: (call) => call.key,
      scope: (call) => idempotencyScopes.tenant(call.scope),
      fingerprint: (call) => call.payload,
      unscopedKeyBehavior,
    });
    return {
      ...c,
      source: 'function',
      hold: h.hold,
      runs: h.runs,
      send: async (call) => resultOutcome(await fn(call)),
    };
  },

  mediator: (unscopedKeyBehavior) => {
    const c = common();
    const h = handlerState();
    type Req = {
      payload: string;
      idempotencyKey: string;
      idempotencyScope?: IdempotencyScope | undefined;
    };
    const mediator = createMediator<{ Create: { request: Req; response: string } }>({
      behaviors: [idempotencyBehavior({ ...c.settings, unscopedKeyBehavior })],
    }).register('Create', async (req) => Result.success(await h.run(req.payload)));
    return {
      ...c,
      source: 'mediator',
      hold: h.hold,
      runs: h.runs,
      send: async (call) =>
        resultOutcome(
          await mediator.send('Create', {
            payload: call.payload,
            idempotencyKey: call.key,
            idempotencyScope: idempotencyScopes.tenant(call.scope),
          }),
        ),
    };
  },

  http: (unscopedKeyBehavior) => {
    const c = common();
    const h = handlerState();
    const handler = withIdempotency(
      async (req: Request) => new Response(await h.run(await req.text()), { status: 201 }),
      {
        ...c.settings,
        scope: (req) => idempotencyScopes.tenant(req.headers.get('x-scope')),
        unscopedKeyBehavior,
      },
    );
    return {
      ...c,
      source: 'http',
      hold: h.hold,
      runs: h.runs,
      send: async (call) => {
        const headers = new Headers({ 'Idempotency-Key': call.key });
        if (call.scope !== undefined) headers.set('x-scope', call.scope);
        const response = await handler(
          new Request('https://api.test/orders', { method: 'POST', headers, body: call.payload }),
        );
        const body = await response.text();
        return {
          status: response.status,
          replayed: response.headers.get('idempotency-replayed'),
          body:
            response.headers.get('content-type') === 'application/problem+json'
              ? (JSON.parse(body) as { code: string }).code
              : body,
        };
      },
    };
  },
};

const scoped = (key: string, payload = 'a'): Call => ({ key, payload, scope: '1' });

/** The four conflict scenarios; each returns what every call of it saw. */
const scenarios: Record<string, (d: Driver) => Promise<Outcome[]>> = {
  replay: async (d) => [await d.send(scoped('k')), await d.send(scoped('k'))],
  keyReused: async (d) => [await d.send(scoped('k')), await d.send(scoped('k', 'other'))],
  inFlight: async (d) => {
    const open = d.hold();
    const first = d.send(scoped('k'));
    await vi.waitFor(() => expect(d.runs()).toBe(1));
    const second = await d.send(scoped('k'));
    open();
    return [await first, second];
  },
  unscoped: async (d) => [await d.send({ key: 'k', payload: 'a' })],
};

const observeEvents: Record<string, string> = {
  replay: IdempotencyEventNames.WouldReplay,
  keyReused: IdempotencyEventNames.WouldRejectKeyReused,
  inFlight: IdempotencyEventNames.WouldRejectInFlight,
  unscoped: IdempotencyEventNames.WouldRejectScopeRequired,
};

describe.each(Object.entries(drivers))('rollout modes: %s', (_name, create) => {
  describe.each(Object.keys(scenarios))('%s', (scenario) => {
    const play = scenarios[scenario]!;

    it('observe answers exactly like off and reports the fixed event name', async () => {
      const off = create('reject');
      off.setMode('off');
      const observe = create('reject');
      observe.setMode('observe');
      const offOutcomes = await play(off);
      const observeOutcomes = await play(observe);

      expect(observeOutcomes).toEqual(offOutcomes);
      expect(observe.runs()).toBe(off.runs());
      expect(off.events).toEqual([]);
      expect(observe.events.map((e) => e.name)).toContain(observeEvents[scenario]);
      expect(observe.events.every((e) => e.mode === 'observe' && e.source === observe.source)).toBe(
        true,
      );
    });

    it('enforce replays or rejects instead', async () => {
      const off = create('reject');
      off.setMode('off');
      const enforce = create('reject');
      const offOutcomes = await play(off);
      const enforceOutcomes = await play(enforce);

      expect(enforceOutcomes).not.toEqual(offOutcomes);
      expect(enforce.events.every((e) => e.name === IdempotencyEventNames.Decision)).toBe(true);
    });
  });

  it('off never calls the store and reports nothing', async () => {
    const d = create('reject');
    d.setMode('off');
    const reserve = vi.spyOn(d.store, 'reserve');
    await d.send(scoped('k'));
    await d.send({ key: 'k', payload: 'a' });
    expect(reserve).not.toHaveBeenCalled();
    expect(d.events).toEqual([]);
    expect(d.runs()).toBe(2);
  });

  it('logs UnscopedKeySkipped in every mode but off with skip', async () => {
    for (const mode of ['observe', 'enforce'] as const) {
      const d = create('skip');
      d.setMode(mode);
      await d.send({ key: 'k', payload: 'a' });
      expect(d.events.map((e) => [e.name, e.decision, e.mode])).toEqual([
        [IdempotencyEventNames.UnscopedKeySkipped, 'unscoped', mode],
      ]);
    }
  });

  it('enforce replays a record completed in observe', async () => {
    const d = create('reject');
    d.setMode('observe');
    const first = await d.send(scoped('k'));
    d.setMode('enforce');
    const second = await d.send(scoped('k'));
    expect(d.runs()).toBe(1);
    expect(d.events.at(-1)?.decision).toBe('replay');
    if (d.source === 'http') {
      expect(second).toEqual({ ...(first as object), replayed: 'true' });
    } else {
      expect(second).toEqual(first);
    }
  });

  it('enforce rejects another payload for a key completed in observe as KeyReused', async () => {
    const d = create('reject');
    d.setMode('observe');
    await d.send(scoped('k'));
    d.setMode('enforce');
    const reused = await d.send(scoped('k', 'other'));
    expect(d.runs()).toBe(1);
    expect(d.events.at(-1)?.decision).toBe('key_reused');
    expect(JSON.stringify(reused)).toContain(IdempotencyErrorCodes.KeyReused);
    if (d.source === 'http') expect((reused as { status: number }).status).toBe(422);
  });

  it('logs Idempotency.Observe.WouldReplay through the logger in observe', async () => {
    const d = create('reject');
    d.setMode('observe');
    await d.send(scoped('k'));
    await d.send(scoped('k'));
    const replays = d.log.mock.calls.filter(
      (c) => (c[2] as { EventName?: string }).EventName === 'Idempotency.Observe.WouldReplay',
    );
    expect(IdempotencyEventNames.WouldReplay).toBe('Idempotency.Observe.WouldReplay');
    expect(replays).toHaveLength(1);
    expect(replays[0]?.[0]).toBe('information');
    expect(replays[0]?.[2]).toMatchObject({ Mode: 'observe', Source: d.source });
  });

  it('enforce rejects a key reserved in observe as in flight', async () => {
    const d = create('reject');
    d.setMode('observe');
    const open = d.hold();
    const first = d.send(scoped('k'));
    await vi.waitFor(() => expect(d.runs()).toBe(1));
    d.setMode('enforce');
    const second = await d.send(scoped('k'));
    open();
    await first;
    expect(JSON.stringify(second)).toContain(IdempotencyErrorCodes.InFlight);
    expect(d.runs()).toBe(1);
  });

  it('reports a 16-hex key hash and never the key itself', async () => {
    const d = create('reject');
    await d.send(scoped('secret-key-value'));
    expect(d.events.length).toBeGreaterThan(0);
    for (const event of d.events) {
      expect(event.keyHash).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(event)).not.toContain('secret-key-value');
    }
  });
});
