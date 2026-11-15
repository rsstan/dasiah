// One upstream service: timeout per request and a circuit breaker. Network errors, timeouts,
// 502 and 504 count as failures; after `breakerThreshold` in a row the breaker opens and requests
// fail fast with 503 until a probe succeeds. A 503 from the service itself (e.g. calculation
// queue full) is a deliberate answer and is passed through without counting.
import { ServiceUnavailableError, type Logger } from '@heatmap/common';
import {
  BrokenCircuitError,
  circuitBreaker,
  ConsecutiveBreaker,
  handleWhen,
  TaskCancelledError,
  timeout,
  TimeoutStrategy,
  wrap,
  type CircuitBreakerPolicy,
} from 'cockatiel';
import { request, type Dispatcher } from 'undici';

export interface UpstreamOptions {
  readonly name: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly breakerThreshold: number;
  readonly breakerHalfOpenMs: number;
  readonly logger: Logger;
}

class UpstreamFailure extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UpstreamFailure';
  }
}

export class Upstream {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly options: UpstreamOptions;
  private readonly breaker: CircuitBreakerPolicy;
  private readonly policy;

  constructor(options: UpstreamOptions) {
    this.options = options;
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.breaker = circuitBreaker(
      handleWhen((e) => e instanceof UpstreamFailure || e instanceof TaskCancelledError),
      { halfOpenAfter: options.breakerHalfOpenMs, breaker: new ConsecutiveBreaker(options.breakerThreshold) },
    );
    this.breaker.onBreak(() => options.logger.warn({ upstream: this.name }, 'circuit opened'));
    this.breaker.onReset(() => options.logger.info({ upstream: this.name }, 'circuit closed'));
    // The timeout covers the time to the response headers; the body then streams to the client.
    // abortOnReturn must be off: the request's signal would otherwise cut the streaming body.
    this.policy = wrap(
      this.breaker,
      timeout(options.timeoutMs, { strategy: TimeoutStrategy.Aggressive, abortOnReturn: false }),
    );
  }

  async send(
    method: string,
    pathAndQuery: string,
    headers: Record<string, string>,
    body: Buffer | undefined,
  ): Promise<Dispatcher.ResponseData> {
    try {
      return await this.policy.execute(async ({ signal }) => {
        let response: Dispatcher.ResponseData;
        try {
          response = await request(`${this.baseUrl}${pathAndQuery}`, {
            method: method as Dispatcher.HttpMethod,
            headers,
            body: body !== undefined && body.length > 0 ? body : null,
            signal,
            bodyTimeout: this.options.timeoutMs,
          });
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          throw new UpstreamFailure(`${this.name}: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
          });
        }
        if (response.statusCode === 502 || response.statusCode === 504) {
          await response.body.dump();
          throw new UpstreamFailure(`${this.name} answered ${response.statusCode}`);
        }
        return response;
      });
    } catch (error) {
      if (error instanceof BrokenCircuitError) {
        throw new ServiceUnavailableError(
          `The ${this.name} service is unavailable.`,
          this.options.breakerHalfOpenMs / 1_000,
          {
            type: '/problems/upstream-unavailable',
          },
        );
      }
      if (error instanceof TaskCancelledError) {
        throw new ServiceUnavailableError(`The ${this.name} service did not answer in time.`, 5, {
          type: '/problems/upstream-timeout',
        });
      }
      if (error instanceof UpstreamFailure) {
        this.options.logger.warn({ upstream: this.name, err: error }, 'upstream failed');
        throw new ServiceUnavailableError(`The ${this.name} service is unavailable.`, 5, {
          type: '/problems/upstream-unavailable',
        });
      }
      throw error;
    }
  }

  /** Readiness of the upstream itself (not through the breaker). */
  async ready(timeoutMs = 1_500): Promise<void> {
    const response = await request(`${this.baseUrl}/health/ready`, { signal: AbortSignal.timeout(timeoutMs) });
    await response.body.dump();
    if (response.statusCode !== 200) {
      throw new Error(`${this.name} not ready (${response.statusCode})`);
    }
  }
}
