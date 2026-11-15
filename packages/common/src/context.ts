// Request context carried through async calls (AsyncLocalStorage): the correlation id and the
// caller. Set by the HTTP server for each request and by the message consumer for each message;
// read by the logger, the HTTP client and the outbox.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  readonly correlationId: string;
  readonly userId?: string;
  readonly userRole?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Header name used on HTTP and in AMQP message headers. */
export const CORRELATION_HEADER = 'x-correlation-id';

const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Keeps a well-formed incoming id; anything else is replaced by a new UUID. */
export function correlationIdFrom(value: unknown): string {
  return typeof value === 'string' && VALID_ID.test(value) ? value : randomUUID();
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
