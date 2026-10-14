import { BrokenCircuitError } from './classifier.js';
import type { Clock, Next, Outcome, Strategy } from './pipeline.js';
import { invoke, thrown } from './pipeline.js';
import { assertDuration } from './strategies.js';

const ONE_DAY_MS = 86_400_000;
const NUMBER_OF_WINDOWS = 10;

/** Circuit-breaker settings. */
export interface CircuitBreakerOptions {
  /**
   * Minimum number of calls inside the sampling window before the failure ratio is
   * evaluated. Integer ≥ 2. Default 10.
   */
  readonly minimumThroughput?: number | undefined;
  /** Rolling window over which the failure ratio is measured, 500 ms … 1 day. Default 60 000. */
  readonly samplingDuration?: number | undefined;
  /** How long the circuit stays open before a trial call is let through, 500 ms … 1 day. Default 30 000. */
  readonly breakDuration?: number | undefined;
  /** Failure ratio (0 … 1) at or above which the circuit opens. Default 0.5. */
  readonly failureRatio?: number | undefined;
}

/** @internal */
export interface CircuitBreakerConfig {
  readonly minimumThroughput: number;
  readonly samplingDuration: number;
  readonly breakDuration: number;
  readonly failureRatio: number;
}

/** @internal Applies the defaults and validates the options. */
export function resolveCircuitBreaker(
  options: CircuitBreakerOptions | undefined,
): CircuitBreakerConfig {
  const minimumThroughput = options?.minimumThroughput ?? 10;
  const samplingDuration = options?.samplingDuration ?? 60_000;
  const breakDuration = options?.breakDuration ?? 30_000;
  const failureRatio = options?.failureRatio ?? 0.5;
  if (!Number.isInteger(minimumThroughput) || minimumThroughput < 2) {
    throw new RangeError(`minimumThroughput must be an integer >= 2 (got ${minimumThroughput}).`);
  }
  assertDuration('samplingDuration', samplingDuration, 500, ONE_DAY_MS);
  assertDuration('breakDuration', breakDuration, 500, ONE_DAY_MS);
  if (!(failureRatio >= 0 && failureRatio <= 1)) {
    throw new RangeError(`failureRatio must be between 0 and 1 (got ${failureRatio}).`);
  }
  return { minimumThroughput, samplingDuration, breakDuration, failureRatio };
}

interface HealthWindow {
  readonly startedAt: number;
  successes: number;
  failures: number;
}

/** Rolling health metrics: 10 buckets of `samplingDuration / 10` each. */
class RollingHealthMetrics {
  private readonly windowDuration: number;
  private windows: HealthWindow[] = [];
  private current: HealthWindow | undefined;

  constructor(
    private readonly samplingDuration: number,
    private readonly now: () => number,
  ) {
    this.windowDuration = samplingDuration / NUMBER_OF_WINDOWS;
  }

  incrementSuccess(): void {
    this.updateCurrentWindow().successes++;
  }

  incrementFailure(): void {
    this.updateCurrentWindow().failures++;
  }

  reset(): void {
    this.current = undefined;
    this.windows = [];
  }

  health(): { throughput: number; failureRate: number } {
    this.updateCurrentWindow();
    let successes = 0;
    let failures = 0;
    for (const w of this.windows) {
      successes += w.successes;
      failures += w.failures;
    }
    const throughput = successes + failures;
    return { throughput, failureRate: throughput === 0 ? 0 : failures / throughput };
  }

  private updateCurrentWindow(): HealthWindow {
    const now = this.now();
    let current = this.current;
    if (current === undefined || now - current.startedAt >= this.windowDuration) {
      current = { startedAt: now, successes: 0, failures: 0 };
      this.current = current;
      this.windows.push(current);
    }
    this.windows = this.windows.filter((w) => now - w.startedAt < this.samplingDuration);
    return current;
  }
}

type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * @internal Circuit breaker. The state lives in the returned strategy, so every policy derived
 * from the policy that added it shares one circuit.
 *
 * - Closed: outcomes are recorded; a handled failure opens the circuit when
 *   `throughput >= minimumThroughput && failureRate >= failureRatio`.
 * - Open: calls are rejected with `Resilience.CircuitBroken` until `breakDuration` has passed;
 *   the next call becomes the half-open trial (and pushes the block forward by `breakDuration`).
 * - Half-open: only the trial call runs (all others are rejected); success closes the circuit and
 *   clears the metrics, a handled failure opens it again.
 *
 * Handled (counted as failure): any thrown value, or a returned Result accepted by `isFailure`.
 */
export function circuitBreakerStrategy(
  config: CircuitBreakerConfig,
  time: Clock,
  isFailure: (outcome: Outcome<unknown>) => boolean,
): Strategy {
  const now = (): number => time.clock.utcNowMs();
  const metrics = new RollingHealthMetrics(config.samplingDuration, now);
  let state: CircuitState = 'closed';
  let blockedUntil = Number.NEGATIVE_INFINITY;

  const open = (): void => {
    blockedUntil = now() + config.breakDuration;
    state = 'open';
  };

  const close = (): void => {
    metrics.reset();
    blockedUntil = Number.NEGATIVE_INFINITY;
    state = 'closed';
  };

  return async <T>(signal: AbortSignal, next: Next<T>): Promise<Outcome<T>> => {
    let isTrial = false;
    if (state === 'open' && now() >= blockedUntil) {
      blockedUntil = now() + config.breakDuration;
      state = 'half-open';
      isTrial = true;
    }
    if (state === 'open' || (state === 'half-open' && !isTrial)) {
      return thrown(new BrokenCircuitError('The circuit is now open and is not allowing calls.'));
    }

    const outcome = await invoke(next, signal);

    if (isFailure(outcome)) {
      if (state === 'half-open') {
        open();
      } else if (state === 'closed') {
        metrics.incrementFailure();
        const { throughput, failureRate } = metrics.health();
        if (throughput >= config.minimumThroughput && failureRate >= config.failureRatio) open();
      } else {
        metrics.incrementFailure();
      }
    } else {
      metrics.incrementSuccess();
      if (state === 'half-open') close();
    }
    return outcome;
  };
}
