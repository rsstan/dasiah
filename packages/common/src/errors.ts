// Typed application errors. The server factory maps each to an RFC 9457 problem response;
// anything else becomes a 500 whose details stay in the logs.

export interface ProblemFields {
  /** Problem kind, a path under /problems, e.g. `/problems/place-limit`. */
  readonly type?: string;
  readonly detail?: string;
  /** Field errors for validation problems. */
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly title: string;
  readonly type: string;
  readonly errors: readonly { readonly path: string; readonly message: string }[] | undefined;

  constructor(detail: string, fields: ProblemFields = {}, options?: ErrorOptions) {
    super(detail, options);
    this.name = new.target.name;
    this.type = fields.type ?? 'about:blank';
    this.errors = fields.errors;
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly title = 'Invalid request';
  constructor(detail: string, fields: ProblemFields = {}) {
    super(detail, { type: '/problems/validation', ...fields });
  }
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly title = 'Authentication required';
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly title = 'Not allowed';
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly title = 'Not found';
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly title = 'Conflict';
}

export class UnprocessableError extends AppError {
  readonly status = 422;
  readonly title = 'Unprocessable request';
}

export class TooManyRequestsError extends AppError {
  readonly status = 429;
  readonly title = 'Too many requests';
  readonly retryAfterS: number;
  constructor(detail: string, retryAfterS: number, fields: ProblemFields = {}) {
    super(detail, fields);
    this.retryAfterS = retryAfterS;
  }
}

/** A dependency is down or the service is overloaded. */
export class ServiceUnavailableError extends AppError {
  readonly status = 503;
  readonly title = 'Service unavailable';
  readonly retryAfterS: number | undefined;
  constructor(detail: string, retryAfterS?: number, fields: ProblemFields = {}, options?: ErrorOptions) {
    super(detail, fields, options);
    this.retryAfterS = retryAfterS;
  }
}

/** An upstream answered with an error status that the caller did not handle. */
export class UpstreamError extends AppError {
  readonly status = 502;
  readonly title = 'Upstream error';
  readonly upstream: string;
  readonly upstreamStatus: number;
  readonly upstreamBody: unknown;
  constructor(detail: string, upstream: string, upstreamStatus: number, upstreamBody?: unknown) {
    super(detail, { type: '/problems/upstream' });
    this.upstream = upstream;
    this.upstreamStatus = upstreamStatus;
    this.upstreamBody = upstreamBody;
  }
}

/** Thrown at start-up when the environment is incomplete or wrong. */
export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}
