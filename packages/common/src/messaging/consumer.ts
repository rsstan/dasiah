// Idempotent event consumer (inbox pattern). For each message on this service's queues:
// 1. decode and validate the envelope against the contract; a malformed message is rejected
//    without requeue and goes straight to the dead-letter queue (poison message);
// 2. restore the correlation id and the trace context of the publisher;
// 3. in one transaction: record the message id in <schema>.processed_messages and apply the
//    handler's effect; if the id was already recorded, skip (duplicate delivery);
// 4. after the commit run what the handler registered with `afterCommit` (changes outside the
//    database, such as swapping something in memory), then ack. A handler error rolls back; the message is published again to the same
//    queue with `x-retry-count` + 1 after a backoff (confirmed before the original is acked).
//    After `maxAttempts` (default 5) it is rejected without requeue, i.e. dead-lettered.
//    RabbitMQ 4 does not count `nack` with requeue towards the quorum queue's delivery limit,
//    so retries are counted here; `x-delivery-limit` still catches messages that crash the
//    consumer (deliveries lost with the channel are counted by the broker).
import { SpanKind } from '@opentelemetry/api';
import {
  topology,
  validateEvent,
  type EventOf,
  type EventType,
  type HeatmapEvent,
  type Topology,
} from '@heatmap/contracts';
import type amqp from 'amqplib';
import type pg from 'pg';
import { correlationIdFrom, runWithContext } from '../context.ts';
import { withTransaction } from '../db.ts';
import type { Logger } from '../logger.ts';
import { withExtractedContext, withSpan } from '../tracing.ts';
import type { BrokerAttachment } from './broker.ts';

/**
 * Registers a synchronous effect outside the database. It runs once the transaction is committed
 * and never when it is rolled back, so nobody sees a change the database does not have.
 */
export type AfterCommit = (effect: () => void) => void;

export type EventHandlers = {
  readonly [T in EventType]?: (event: EventOf<T>, tx: pg.PoolClient, afterCommit: AfterCommit) => Promise<void>;
};

export interface EventConsumerOptions {
  readonly pool: pg.Pool;
  /** Schema that holds processed_messages, e.g. `places`. */
  readonly schema: string;
  /** Consumer name in the topology (the service name). */
  readonly consumer: string;
  readonly logger: Logger;
  readonly handlers: EventHandlers;
  readonly prefetch?: number;
  readonly topology?: Topology;
  /** Attempts before a failing message is dead-lettered (default: the topology's delivery limit). */
  readonly maxAttempts?: number;
  /** First retry delay; doubles per attempt, capped at 10 s. */
  readonly retryDelayMs?: number;
}

/** processed / duplicate: acked. failed: retried later. rejected / dead-lettered: in the DLQ. */
export type Outcome = 'processed' | 'duplicate' | 'failed' | 'rejected' | 'dead-lettered';

export const RETRY_HEADER = 'x-retry-count';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export class EventConsumer implements BrokerAttachment {
  private readonly options: EventConsumerOptions;
  private channel: amqp.ConfirmChannel | undefined;
  private consumerTags: string[] = [];
  private inFlight = 0;
  private stopping = false;
  /** Called after each message, for tests and metrics. */
  onOutcome: ((outcome: Outcome, messageId: string | undefined) => void) | undefined;

  constructor(options: EventConsumerOptions) {
    if (!IDENTIFIER.test(options.schema)) {
      throw new Error(`invalid schema name ${options.schema}`);
    }
    this.options = options;
  }

  /** Queues of this consumer that have a handler. */
  queues(): { name: string; routingKey: EventType }[] {
    const t = this.options.topology ?? topology;
    return t.queues
      .filter((q) => q.consumer === this.options.consumer && this.options.handlers[q.routingKey] !== undefined)
      .map((q) => ({ name: q.name, routingKey: q.routingKey }));
  }

  async attach(model: amqp.ChannelModel): Promise<void> {
    if (this.stopping) {
      return;
    }
    // Confirm channel: a retry copy must be confirmed before the original is acked.
    const channel = await model.createConfirmChannel();
    channel.on('error', (error: Error) => this.options.logger.warn({ err: error }, 'consumer channel error'));
    await channel.prefetch(this.options.prefetch ?? 10);
    this.channel = channel;
    this.consumerTags = [];
    for (const queue of this.queues()) {
      const { consumerTag } = await channel.consume(queue.name, (msg) => void this.handle(channel, queue.name, msg), {
        noAck: false,
      });
      this.consumerTags.push(consumerTag);
      this.options.logger.info({ queue: queue.name }, 'consuming');
    }
  }

  /** Stops taking new messages and waits for the ones being handled. */
  async stop(timeoutMs = 10_000): Promise<void> {
    this.stopping = true;
    const channel = this.channel;
    if (channel !== undefined) {
      await Promise.all(this.consumerTags.map((tag) => channel.cancel(tag).catch(() => undefined)));
    }
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await channel?.close().catch(() => undefined);
    this.channel = undefined;
  }

  private async handle(channel: amqp.ConfirmChannel, queue: string, msg: amqp.ConsumeMessage | null): Promise<void> {
    if (msg === null) {
      this.options.logger.warn('consumer cancelled by the broker');
      return;
    }
    this.inFlight++;
    const messageId = typeof msg.properties.messageId === 'string' ? msg.properties.messageId : undefined;
    const headers = (msg.properties.headers ?? {}) as Record<string, unknown>;
    const retries = typeof headers[RETRY_HEADER] === 'number' ? headers[RETRY_HEADER] : 0;
    try {
      let body: unknown;
      try {
        body = JSON.parse(msg.content.toString('utf8'));
      } catch {
        body = undefined;
      }
      const check = validateEvent(body);
      if (!check.ok) {
        this.options.logger.error(
          { message_id: messageId, routing_key: msg.fields.routingKey, errors: check.errors },
          'poison message rejected to the dead-letter queue',
        );
        channel.nack(msg, false, false);
        this.onOutcome?.('rejected', messageId);
        return;
      }
      const event = check.event;
      const correlationId = event.correlationId ?? correlationIdFrom(headers['x-correlation-id']);
      const outcome = await runWithContext({ correlationId }, () =>
        withExtractedContext(headers, () =>
          withSpan(
            `process ${event.type}`,
            () => this.process(event),
            {
              'messaging.system': 'rabbitmq',
              'messaging.message.id': event.id,
              'messaging.destination.name': msg.fields.routingKey,
              'messaging.consumer.group.name': this.options.consumer,
            },
            SpanKind.CONSUMER,
          ),
        ).then(
          (result) => {
            channel.ack(msg);
            this.options.logger.info({ event_id: event.id, event_type: event.type, outcome: result }, 'event handled');
            return result;
          },
          (error: unknown) => this.retryOrDeadLetter(channel, queue, msg, headers, retries + 1, error, event),
        ),
      );
      this.onOutcome?.(outcome, messageId);
    } finally {
      this.inFlight--;
    }
  }

  private async retryOrDeadLetter(
    channel: amqp.ConfirmChannel,
    queue: string,
    msg: amqp.ConsumeMessage,
    headers: Record<string, unknown>,
    attempts: number,
    error: unknown,
    event: HeatmapEvent,
  ): Promise<Outcome> {
    const { logger } = this.options;
    const maxAttempts = this.options.maxAttempts ?? (this.options.topology ?? topology).deliveryLimit;
    const fields = { err: error, event_id: event.id, event_type: event.type, attempts };
    if (attempts >= maxAttempts) {
      logger.error(fields, 'event handler kept failing, message dead-lettered');
      channel.nack(msg, false, false);
      return 'dead-lettered';
    }
    const delay = Math.min(10_000, (this.options.retryDelayMs ?? 200) * 2 ** (attempts - 1));
    logger.warn({ ...fields, retry_in_ms: delay }, 'event handler failed, will retry');
    await new Promise((r) => setTimeout(r, delay));
    try {
      await new Promise<void>((resolve, reject) => {
        channel.sendToQueue(
          queue,
          msg.content,
          {
            persistent: true,
            messageId: msg.properties.messageId as string | undefined,
            type: msg.properties.type as string | undefined,
            contentType: msg.properties.contentType as string | undefined,
            appId: msg.properties.appId as string | undefined,
            timestamp: msg.properties.timestamp as number | undefined,
            headers: { ...headers, [RETRY_HEADER]: attempts },
          },
          (err: unknown) => (err === null || err === undefined ? resolve() : reject(err)),
        );
      });
      channel.ack(msg);
    } catch (publishError) {
      // The original stays unacked; the broker redelivers it when the channel goes away.
      logger.warn({ err: publishError, event_id: event.id }, 'retry copy not confirmed, original left for redelivery');
    }
    return 'failed';
  }

  private async process(event: HeatmapEvent): Promise<'processed' | 'duplicate'> {
    const handler = this.options.handlers[event.type] as
      ((e: HeatmapEvent, tx: pg.PoolClient, afterCommit: AfterCommit) => Promise<void>) | undefined;
    if (handler === undefined) {
      throw new Error(`no handler for ${event.type}`);
    }
    const effects: (() => void)[] = [];
    const outcome = await withTransaction(this.options.pool, async (tx) => {
      const { rowCount } = await tx.query(
        `INSERT INTO ${this.options.schema}.processed_messages (message_id, event_type) VALUES ($1, $2)
         ON CONFLICT (message_id) DO NOTHING`,
        [event.id, event.type],
      );
      if (rowCount === 0) {
        return 'duplicate' as const;
      }
      await handler(event, tx, (effect) => effects.push(effect));
      return 'processed' as const;
    });
    for (const effect of effects) {
      effect();
    }
    return outcome;
  }
}
