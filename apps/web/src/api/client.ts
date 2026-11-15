// Thin fetch wrapper for the gateway: one correlation id per call (sent as X-Correlation-Id and
// kept on errors so a user can quote it), JSON in and out, problem+json turned into ApiError.
import type { Problem } from './types.ts';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly retryAfterS: number | undefined;
  readonly correlationId: string;

  constructor(status: number, problem: Partial<Problem>, correlationId: string, retryAfterS?: number) {
    super(problem.detail ?? problem.title ?? `Request failed with ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.type = problem.type ?? 'about:blank';
    this.retryAfterS = retryAfterS;
    this.correlationId = correlationId;
  }
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

/** Supplies the Authorization header value; set by the session code (8.2). */
let authorization: () => string | undefined = () => undefined;
export function setAuthorization(provider: () => string | undefined): void {
  authorization = provider;
}

export function buildUrl(path: string, query: RequestOptions['query'] = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return `${API_BASE}${path}${search === '' ? '' : `?${search}`}`;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const correlationId = crypto.randomUUID();
  const headers: Record<string, string> = { accept: 'application/json', 'x-correlation-id': correlationId };
  const auth = authorization();
  if (auth !== undefined) {
    headers['authorization'] = auth;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, { title: 'The server cannot be reached. Check your connection.' }, correlationId);
  }
  const text = await response.text();
  let body: unknown = undefined;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const problem = (typeof body === 'object' && body !== null ? body : {}) as Partial<Problem>;
    throw new ApiError(
      response.status,
      problem,
      response.headers.get('x-correlation-id') ?? correlationId,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
  return { status: response.status, body: body as T };
}

/** Wording for the problem types a user can run into (contracts/openapi/*.yaml). */
const PROBLEM_TEXT: Record<string, string> = {
  '/problems/origin-outside-city': 'The start point is outside the selected city. Pick a point inside it.',
  '/problems/date-outside-feed': 'The timetable does not cover this date. Pick a date inside its validity.',
  '/problems/no-timetable': 'The timetable of this city is not loaded yet.',
  '/problems/calculations-busy': 'The server is computing many maps right now.',
  '/problems/car-routing-unavailable': 'Car routing is unavailable right now, so the map cannot be computed.',
  '/problems/geocoder-unavailable': 'Address search is unavailable right now.',
};

/** Short user-facing text for an error; the correlation id is shown separately. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong.';
  }
  const known = PROBLEM_TEXT[error.type];
  if (known !== undefined) {
    return error.retryAfterS === undefined ? known : `${known} Try again in ${error.retryAfterS} s.`;
  }
  if (error.status === 429) {
    return `Too many requests. Try again in ${error.retryAfterS ?? 60} s.`;
  }
  if (error.status === 503 && error.retryAfterS !== undefined) {
    return `${error.message} Try again in ${error.retryAfterS} s.`;
  }
  return error.message;
}
