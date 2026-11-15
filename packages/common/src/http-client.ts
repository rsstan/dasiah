// Resilient JSON client for service-to-service and third-party calls (fetch + cockatiel):
// - timeout on every attempt (the request is aborted);
// - retry with exponential backoff and jitter, only for idempotent methods (GET, HEAD);
// - one circuit breaker per client: after N consecutive failures calls fail fast for a while;
// - X-Correlation-Id from the request context on every call (traceparent is added by the
//   undici instrumentation).
// Network errors, timeouts, 502/503/504 and an open breaker surface as ServiceUnavailableError,
// so the caller's own response becomes a 503 with Retry-After. Other statuses are returned.
import {
  BrokenCircuitError,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  retry,
  TaskCancelledError,
  timeout,
  TimeoutStrategy,
  wrap,
  type CircuitBreakerPolicy,
} from 'cockatiel';
import { currentCorrelationId, CORRELATION_HEADER } from './context.ts';
import { ServiceUnavailableError, UpstreamError } from './errors.ts';
import type { Logger } from './logger.ts';

export interface HttpClientOptions {
  /** Name of the upstream, used in errors and logs, e.g. `transit-data`. */
  readonly name: string;
  readonly baseUrl: string;
  readonly logger: Logger;
  readonly timeoutMs?: number;
  /** Extra attempts for GET/HEAD after the first one. */
  readonly retries?: number;
  readonly retryInitialDelayMs?: number;
  readonly breakerThreshold?: number;
  readonly breakerHalfOpenAfterMs?: number;
  readonly headers?: Record<string, string>;
}

export interface RequestOptions {
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface HttpResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
}

/** A failure that counts for the breaker and the retry policy. */
class TransientFailure extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransientFailure';
    this.status = status;
  }
}

const TRANSIENT_STATUS = new Set([502, 503, 504]);
const IDEMPOTENT = new Set(['GET', 'HEAD']);

export class HttpClient {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly defaultHeaders: Record<string, string>;
  private readonly breaker: CircuitBreakerPolicy;
  private readonly halfOpenAfterMs: number;
  private readonly idempotentPolicy;
  private readonly otherPolicy;

  constructor(options: HttpClientOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.logger = options.logger;
    this.defaultHeaders = options.headers ?? {};
    this.halfOpenAfterMs = options.breakerHalfOpenAfterMs ?? 10_000;
    const transient = handleWhen((e) => e instanceof TransientFailure || e instanceof TaskCancelledError);
    this.breaker = circuitBreaker(transient, {
      halfOpenAfter: this.halfOpenAfterMs,
      breaker: new ConsecutiveBreaker(options.breakerThreshold ?? 5),
    });
    this.breaker.onBreak(() => this.logger.warn({ upstream: this.name }, 'circuit opened'));
    this.breaker.onReset(() => this.logger.info({ upstream: this.name }, 'circuit closed'));
    const perAttemptTimeout = timeout(options.timeoutMs ?? 5_000, TimeoutStrategy.Aggressive);
    const retryPolicy = retry(transient, {
      maxAttempts: options.retries ?? 2,
      backoff: new ExponentialBackoff({ initialDelay: options.retryInitialDelayMs ?? 100, maxDelay: 2_000 }),
    });
    retryPolicy.onRetry((e) => this.logger.debug({ upstream: this.name, delay_ms: e.delay }, 'retrying'));
    // Retry outermost: each attempt goes through the breaker and has its own timeout.
    this.idempotentPolicy = wrap(retryPolicy, this.breaker, perAttemptTimeout);
    this.otherPolicy = wrap(this.breaker, perAttemptTimeout);
  }

  /** Current breaker state, for readiness and logs. */
  get circuitState(): string {
    return String(this.breaker.state);
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { accept: 'application/json', ...this.defaultHeaders, ...options.headers };
    const correlationId = currentCorrelationId();
    if (correlationId !== undefined) {
      headers[CORRELATION_HEADER] = correlationId;
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const policy = IDEMPOTENT.has(method.toUpperCase()) ? this.idempotentPolicy : this.otherPolicy;
    try {
      return await policy.execute(async ({ signal }) => {
        let response: Response;
        try {
          response = await fetch(url, { method, headers, signal, ...(body === undefined ? {} : { body }) });
        } catch (error) {
          if (signal.aborted) {
            throw error; // the timeout policy turns it into TaskCancelledError
          }
          throw new TransientFailure(
            `${this.name}: ${error instanceof Error ? error.message : String(error)}`,
            undefined,
            {
              cause: error,
            },
          );
        }
        if (TRANSIENT_STATUS.has(response.status)) {
          await response.body?.cancel();
          throw new TransientFailure(`${this.name} answered ${response.status}`, response.status);
        }
        return { status: response.status, headers: response.headers, body: (await readBody(response)) as T };
      });
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  /** GET that expects 2xx; any other status becomes an UpstreamError. */
  async getJson<T>(path: string, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    const response = await this.request<T>('GET', path, options);
    if (response.status < 200 || response.status >= 300) {
      throw new UpstreamError(
        `${this.name} answered ${response.status} for GET ${path}`,
        this.name,
        response.status,
        response.body,
      );
    }
    return response.body;
  }

  private unavailable(error: unknown): Error {
    if (error instanceof BrokenCircuitError) {
      return new ServiceUnavailableError(
        `${this.name} is unavailable (circuit open)`,
        this.halfOpenAfterMs / 1000,
        {},
        { cause: error },
      );
    }
    if (error instanceof TaskCancelledError) {
      return new ServiceUnavailableError(`${this.name} did not answer in time`, 5, {}, { cause: error });
    }
    if (error instanceof TransientFailure) {
      return new ServiceUnavailableError(error.message, 5, {}, { cause: error });
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 304) {
    await response.body?.cancel();
    return undefined;
  }
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    return response.json();
  }
  return response.text();
}
