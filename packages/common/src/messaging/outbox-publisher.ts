// Transactional outbox publisher. A state change and its event are committed together into
// <schema>.outbox; this loop sends pending rows to `heatmap.events` with publisher confirms and
// marks them published in the same database transaction that locked them. If the broker does
// not confirm, the transaction rolls back and the rows are sent again later: delivery is at
// least once, consumers deduplicate by message id.
import { SpanKind } from '@opentelemetry/api';
import { topology, validateEvent, type EventType } from '@heatmap/contracts';
import type amqp from 'amqplib';
import type pg from 'pg';
import { withTransaction } from '../db.ts';
import type { Logger } from '../logger.ts';
import { injectTraceHeaders, withExtractedContext, withSpan } from '../tracing.ts';
import type { BrokerAttachment } from './broker.ts';

export interface OutboxPublisherOptions {
  readonly pool: pg.Pool;
  /** Schema that holds the outbox table, e.g. `identity`. */
  readonly schema: string;
  /** Value of `source` in the envelope (the service name). */
  readonly source: string;
  readonly logger: Logger;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  /** Event types whose rows are deleted right after publishing (they carry a user id). */
  readonly deleteAfterPublish?: readonly EventType[];
  /** Published rows older than this are deleted. */
  readonly retentionDays?: number;
}

interface OutboxRow {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  correlation_id: string | null;
  traceparent: string | null;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export class OutboxPublisher implements BrokerAttachment {
  private readonly options: Required<Omit<OutboxPublisherOptions, 'deleteAfterPublish'>> & {
    deleteAfterPublish: readonly EventType[];
  };
  private readonly table: string;
  private channel: amqp.ConfirmChannel | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;
  private stopped = true;
  private wakeRequested = false;
  private lastCleanup = 0;

  constructor(options: OutboxPublisherOptions) {
    if (!IDENTIFIER.test(options.schema)) {
      throw new Error(`invalid schema name ${options.schema}`);
    }
    this.options = {
      batchSize: 100,
      pollIntervalMs: 500,
      retentionDays: 7,
      deleteAfterPublish: [],
      ...options,
    };
    this.table = `${options.schema}.outbox`;
  }

  async attach(model: amqp.ChannelModel): Promise<void> {
    const channel = await model.createConfirmChannel();
    channel.on('error', (error: Error) => this.options.logger.warn({ err: error }, 'outbox channel error'));
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = undefined;
      }
    });
    this.channel = channel;
    this.wake();
  }

  /** Starts the polling loop. */
  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  /** Asks for a poll as soon as possible, e.g. right after a transaction that wrote an event. */
  wake(): void {
    if (this.stopped) {
      return;
    }
    if (this.running !== undefined) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  }

  /** Stops the loop and waits for the batch in progress. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running !== undefined) {
      return;
    }
    let sent = 0;
    this.running = this.publishBatch();
    try {
      sent = await this.running;
      await this.cleanup();
    } catch (error) {
      this.options.logger.warn({ err: error }, 'outbox batch failed, will retry');
    } finally {
      this.running = undefined;
    }
    if (!this.stopped) {
      const again = sent === this.options.batchSize || this.wakeRequested;
      this.wakeRequested = false;
      this.schedule(again ? 0 : this.options.pollIntervalMs);
    }
  }

  /** Publishes one batch; returns the number of rows sent. Exposed for tests. */
  async publishBatch(): Promise<number> {
    const channel = this.channel;
    if (channel === undefined) {
      return 0;
    }
    const { pool, batchSize, source, logger, deleteAfterPublish } = this.options;
    return withTransaction(pool, async (tx) => {
      const { rows } = await tx.query<OutboxRow>(
        `SELECT event_id, event_type, payload, occurred_at, correlation_id, traceparent
           FROM ${this.table} WHERE published_at IS NULL
          ORDER BY occurred_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      const sent: OutboxRow[] = [];
      for (const row of rows) {
        const envelope = {
          id: row.event_id,
          type: row.event_type,
          source,
          time: row.occurred_at.toISOString(),
          correlationId: row.correlation_id,
          data: row.payload,
        };
        const check = validateEvent(envelope);
        if (!check.ok) {
          // Never send what consumers would reject; the row stays and is reported every batch.
          logger.error(
            { event_id: row.event_id, event_type: row.event_type, errors: check.errors },
            'outbox row violates the contract',
          );
          continue;
        }
        const parent = row.traceparent === null ? {} : { traceparent: row.traceparent };
        await withExtractedContext(parent, () =>
          withSpan(
            `publish ${row.event_type}`,
            async () => {
              const headers: Record<string, string> = injectTraceHeaders();
              if (row.correlation_id !== null) {
                headers['x-correlation-id'] = row.correlation_id;
              }
              channel.publish(topology.exchange.name, row.event_type, Buffer.from(JSON.stringify(envelope)), {
                persistent: true,
                messageId: row.event_id,
                type: row.event_type,
                contentType: 'application/json',
                appId: source,
                timestamp: Math.floor(row.occurred_at.getTime() / 1000),
                headers,
              });
            },
            {
              'messaging.system': 'rabbitmq',
              'messaging.destination.name': topology.exchange.name,
              'messaging.message.id': row.event_id,
            },
            SpanKind.PRODUCER,
          ),
        );
        sent.push(row);
      }
      if (sent.length === 0) {
        return 0;
      }
      await channel.waitForConfirms(); // throws if the broker nacks or the channel closes: rollback
      const toDelete = sent
        .filter((r) => deleteAfterPublish.includes(r.event_type as EventType))
        .map((r) => r.event_id);
      const toMark = sent.filter((r) => !toDelete.includes(r.event_id)).map((r) => r.event_id);
      if (toMark.length > 0) {
        await tx.query(`UPDATE ${this.table} SET published_at = now() WHERE event_id = ANY ($1::uuid[])`, [toMark]);
      }
      if (toDelete.length > 0) {
        await tx.query(`DELETE FROM ${this.table} WHERE event_id = ANY ($1::uuid[])`, [toDelete]);
      }
      for (const row of sent) {
        logger.info(
          {
            event_id: row.event_id,
            event_type: row.event_type,
            ...(row.correlation_id === null ? {} : { correlation_id: row.correlation_id }),
          },
          'event published',
        );
      }
      return sent.length;
    });
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < 3_600_000) {
      return;
    }
    this.lastCleanup = now;
    const { rowCount } = await this.options.pool.query(
      `DELETE FROM ${this.table} WHERE published_at < now() - make_interval(days => $1)`,
      [this.options.retentionDays],
    );
    if ((rowCount ?? 0) > 0) {
      this.options.logger.info({ deleted: rowCount }, 'old outbox rows deleted');
    }
  }
}
