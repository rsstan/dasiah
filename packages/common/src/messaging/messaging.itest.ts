import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { topology } from '@heatmap/contracts';
import amqp from 'amqplib';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { currentCorrelationId, runWithContext } from '../context.ts';
import { createPool, withTransaction } from '../db.ts';
import { captureLogger } from '../test-support.ts';
import { Broker } from './broker.ts';
import { EventConsumer, type Outcome } from './consumer.ts';
import { OutboxPublisher } from './outbox-publisher.ts';

let pg16: StartedPostgreSqlContainer;
let rabbit: StartedRabbitMQContainer;
let pool: pg.Pool;
let publisherBroker: Broker;
let consumerBroker: Broker;
let publisher: OutboxPublisher;
let accessibilityPublisher: OutboxPublisher;
let consumer: EventConsumer;
let raw: amqp.ChannelModel;
let rawChannel: amqp.Channel;

const outcomes: { outcome: Outcome; messageId: string | undefined }[] = [];
const seenCorrelationIds: (string | undefined)[] = [];
const failuresLeft = new Map<string, number>();
/** Events whose transaction fails at COMMIT (a deferred constraint). */
const commitFails = new Set<string>();
const committedEffects: string[] = [];
const ALWAYS_FAILS = '00000000-0000-4000-8000-0000000000ff';

const waitFor = async (
  what: string,
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 30_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};

const erasedCount = async (userId: string): Promise<number> =>
  (await pool.query<{ n: number }>('SELECT count(*) AS n FROM demo.erased WHERE user_id = $1', [userId])).rows[0]?.n ??
  0;

/** Writes an identity.user.deleted.v1 row the way a service command does. */
const writeUserDeleted = (userId: string, correlationId: string) =>
  runWithContext({ correlationId }, () =>
    withTransaction(pool, (tx) =>
      tx.query(`INSERT INTO demo.outbox (event_type, payload) VALUES ('identity.user.deleted.v1', $1)`, [{ userId }]),
    ),
  );

/** Drains the dead-letter queue. */
async function deadLetters(): Promise<amqp.GetMessage[]> {
  const found: amqp.GetMessage[] = [];
  for (;;) {
    const msg = await rawChannel.get(topology.deadLetterQueue, { noAck: true });
    if (msg === false) {
      return found;
    }
    found.push(msg);
  }
}

beforeAll(async () => {
  [pg16, rabbit] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
      .withCommand(['postgres', '-c', 'fsync=off'])
      .start(),
    new RabbitMQContainer('rabbitmq:4.3.7-management-alpine')
      .withTmpFs({ '/var/lib/rabbitmq': 'rw' })
      .withStartupTimeout(120_000)
      .start(),
  ]);
  pool = createPool({ connectionString: pg16.getConnectionUri(), applicationName: 'messaging-itest', max: 5 });
  // Same shape as <schema>.outbox and <schema>.processed_messages in the service migrations.
  await pool.query(`
    CREATE SCHEMA demo;
    CREATE TABLE demo.outbox (
      event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz,
      correlation_id text DEFAULT nullif(current_setting('app.correlation_id', true), ''),
      traceparent text DEFAULT nullif(current_setting('app.traceparent', true), ''));
    CREATE TABLE demo.processed_messages (
      message_id uuid PRIMARY KEY, event_type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE demo.parents (id uuid PRIMARY KEY);
    CREATE TABLE demo.children (
      parent_id uuid NOT NULL REFERENCES demo.parents (id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TABLE demo.erased (user_id uuid NOT NULL, at timestamptz NOT NULL DEFAULT now());
  `);

  const { logger } = captureLogger('messaging-itest');
  publisherBroker = new Broker({ url: rabbit.getAmqpUrl(), service: 'identity', logger });
  publisher = new OutboxPublisher({
    pool,
    schema: 'demo',
    source: 'identity',
    logger,
  });
  publisherBroker.attach(publisher);
  accessibilityPublisher = new OutboxPublisher({
    pool,
    schema: 'demo',
    source: 'accessibility',
    logger,
    deleteAfterPublish: ['accessibility.calculation.completed.v1'],
  });
  publisherBroker.attach(accessibilityPublisher);

  consumerBroker = new Broker({ url: rabbit.getAmqpUrl(), service: 'places', logger });
  consumer = new EventConsumer({
    pool,
    schema: 'demo',
    consumer: 'places',
    logger,
    retryDelayMs: 10,
    handlers: {
      'identity.user.deleted.v1': async (event, tx, afterCommit) => {
        seenCorrelationIds.push(currentCorrelationId());
        const left = failuresLeft.get(event.data.userId) ?? 0;
        if (event.data.userId === ALWAYS_FAILS || left > 0) {
          failuresLeft.set(event.data.userId, left - 1);
          throw new Error('transient failure');
        }
        await tx.query('INSERT INTO demo.erased (user_id) VALUES ($1)', [event.data.userId]);
        if (commitFails.has(event.data.userId)) {
          await tx.query('INSERT INTO demo.children (parent_id) VALUES ($1)', [event.data.userId]);
        }
        afterCommit(() => committedEffects.push(event.data.userId));
      },
    },
  });
  consumer.onOutcome = (outcome, messageId) => outcomes.push({ outcome, messageId });
  consumerBroker.attach(consumer);

  await Promise.all([publisherBroker.start(), consumerBroker.start()]);
  raw = await amqp.connect(rabbit.getAmqpUrl());
  rawChannel = await raw.createChannel();
});

afterAll(async () => {
  await consumer?.stop();
  await publisher?.stop();
  await accessibilityPublisher?.stop();
  await Promise.all([publisherBroker?.close(), consumerBroker?.close(), raw?.close()]);
  await pool?.end();
  await Promise.all([pg16?.stop(), rabbit?.stop()]);
});

beforeEach(async () => {
  outcomes.length = 0;
  seenCorrelationIds.length = 0;
  committedEffects.length = 0;
  await deadLetters();
});

describe('messaging', () => {
  it('declares the topology from the contract', async () => {
    const q = await rawChannel.checkQueue('places.identity.user.deleted.v1');
    expect(q.queue).toBe('places.identity.user.deleted.v1');
    await expect(rawChannel.checkQueue(topology.deadLetterQueue)).resolves.toBeDefined();
    await expect(publisherBroker.check()).resolves.toBeUndefined();
  });

  it('delivers an outbox event to the consumer with its correlation id and trace context', async () => {
    const userId = randomUUID();
    await writeUserDeleted(userId, 'it-corr-1');
    const row = (await pool.query('SELECT correlation_id FROM demo.outbox WHERE payload->>$1 = $2', ['userId', userId]))
      .rows[0];
    expect(row).toEqual({ correlation_id: 'it-corr-1' });

    expect(await publisher.publishBatch()).toBe(1);
    // The outcome is reported after commit and ack; the row alone is visible a moment earlier.
    await waitFor('the outcome', () => outcomes.length === 1);
    expect(await erasedCount(userId)).toBe(1);
    expect(committedEffects).toEqual([userId]);
    const published = await pool.query(`SELECT published_at FROM demo.outbox WHERE payload->>'userId' = $1`, [userId]);
    expect(published.rows[0]?.published_at).not.toBeNull();
    expect(seenCorrelationIds).toEqual(['it-corr-1']);
    expect(outcomes.map((o) => o.outcome)).toEqual(['processed']);
  });

  it('is at least once: a failing handler gets the message again and the effect happens once', async () => {
    const userId = randomUUID();
    failuresLeft.set(userId, 2);
    await writeUserDeleted(userId, 'it-corr-2');
    await publisher.publishBatch();
    await waitFor('processing after retries', () => outcomes.some((o) => o.outcome === 'processed'));
    expect(outcomes.map((o) => o.outcome)).toEqual(['failed', 'failed', 'processed']);
    expect(await erasedCount(userId)).toBe(1);
  });

  it('runs after-commit effects only when the commit succeeds', async () => {
    const userId = randomUUID();
    commitFails.add(userId);
    await writeUserDeleted(userId, 'it-corr-commit');
    await publisher.publishBatch();
    await waitFor('the first failure', () => outcomes.some((o) => o.outcome === 'failed'));
    expect(committedEffects).toEqual([]);
    expect(await erasedCount(userId)).toBe(0);

    commitFails.delete(userId); // the next attempt commits
    await waitFor('the retry', () => outcomes.some((o) => o.outcome === 'processed'));
    expect(committedEffects).toEqual([userId]);
    expect(await erasedCount(userId)).toBe(1);
  });

  it('skips a duplicate delivery of the same message id', async () => {
    const userId = randomUUID();
    const envelope = {
      id: randomUUID(),
      type: 'identity.user.deleted.v1',
      source: 'identity',
      time: new Date().toISOString(),
      correlationId: 'it-corr-3',
      data: { userId },
    };
    // As if the publisher crashed after the broker confirmed but before marking the row.
    for (let i = 0; i < 2; i++) {
      rawChannel.publish(topology.exchange.name, envelope.type, Buffer.from(JSON.stringify(envelope)), {
        messageId: envelope.id,
        persistent: true,
      });
    }
    await waitFor('both deliveries', () => outcomes.length === 2);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['duplicate', 'processed']);
    expect(await erasedCount(userId)).toBe(1);
  });

  it('dead-letters poison messages: malformed JSON and contract violations at once', async () => {
    rawChannel.publish(topology.exchange.name, 'identity.user.deleted.v1', Buffer.from('{not json'), {
      messageId: 'poison-1',
    });
    rawChannel.publish(
      topology.exchange.name,
      'identity.user.deleted.v1',
      Buffer.from(JSON.stringify({ id: randomUUID(), type: 'identity.user.deleted.v1', source: 'identity', data: {} })),
      { messageId: 'poison-2' },
    );
    await waitFor('two rejections', () => outcomes.filter((o) => o.outcome === 'rejected').length === 2);
    let dlq: amqp.GetMessage[] = [];
    await waitFor('the dead-letter queue', async () => {
      dlq = dlq.concat(await deadLetters());
      return dlq.length === 2;
    });
    expect(dlq.map((m) => m.properties.messageId).sort()).toEqual(['poison-1', 'poison-2']);
    expect(dlq.every((m) => m.properties.headers?.['x-first-death-reason'] === 'rejected')).toBe(true);
  });

  it('dead-letters a message whose handler keeps failing after the delivery limit', async () => {
    await writeUserDeleted(ALWAYS_FAILS, 'it-corr-4');
    await publisher.publishBatch();
    let dlq: amqp.GetMessage[] = [];
    await waitFor(
      'the dead-letter queue',
      async () => {
        dlq = dlq.concat(await deadLetters());
        return dlq.length === 1;
      },
      30_000,
    );
    expect(outcomes.map((o) => o.outcome)).toEqual(['failed', 'failed', 'failed', 'failed', 'dead-lettered']);
    expect(dlq[0]?.properties.headers?.['x-first-death-reason']).toBe('rejected');
    expect(dlq[0]?.properties.headers?.['x-retry-count']).toBe(topology.deliveryLimit - 1);
    expect(await erasedCount(ALWAYS_FAILS)).toBe(0);
  });

  it('never sends a row that violates the contract and deletes rows that carry a user id', async () => {
    await pool.query(
      `INSERT INTO demo.outbox (event_type, payload) VALUES ('identity.user.deleted.v1', '{"userId": "not-a-uuid"}')`,
    );
    await pool.query(
      `INSERT INTO demo.outbox (event_type, payload) VALUES ('accessibility.calculation.completed.v1', $1)`,
      [
        {
          calculationId: randomUUID(),
          cityCode: 'waw',
          originH3: '8a1f53c9a437fff',
          userId: randomUUID(),
          cacheHit: false,
        },
      ],
    );
    // identity may not publish accessibility events, and the malformed row is refused by everyone.
    expect(await publisher.publishBatch()).toBe(0);
    expect(await accessibilityPublisher.publishBatch()).toBe(1);
    // A refused row is reported once and then left out, so it cannot block later events.
    const userId = randomUUID();
    await writeUserDeleted(userId, 'it-corr-5');
    expect(await publisher.publishBatch()).toBe(1);
    await waitFor('the later event', async () => (await erasedCount(userId)) === 1);
    const left = await pool.query<{ event_type: string; payload: unknown }>(
      `SELECT event_type, payload FROM demo.outbox WHERE published_at IS NULL`,
    );
    expect(left.rows).toEqual([{ event_type: 'identity.user.deleted.v1', payload: { userId: 'not-a-uuid' } }]);
    const completed = await pool.query(
      `SELECT 1 FROM demo.outbox WHERE event_type = 'accessibility.calculation.completed.v1'`,
    );
    expect(completed.rowCount).toBe(0); // deleted right after publishing: it carried a user id
    await pool.query(`DELETE FROM demo.outbox WHERE published_at IS NULL`);
  });
});
