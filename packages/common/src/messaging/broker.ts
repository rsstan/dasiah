// RabbitMQ connection with automatic recovery. On every (re)connect the topology from
// contracts/asyncapi is declared and every attached publisher and consumer recreates its
// channel, so a broker restart heals without restarting the service.
import { topology, type Topology } from '@heatmap/contracts';
import amqp from 'amqplib';
import type { Logger } from '../logger.ts';

type ChannelModel = amqp.ChannelModel;

/** Something that needs a channel on every connection (publisher, consumer). */
export interface BrokerAttachment {
  attach(model: ChannelModel): Promise<void>;
}

export interface BrokerOptions {
  readonly url: string;
  /** Service name; its consumer queues are declared. */
  readonly service: string;
  readonly logger: Logger;
  /** Attempts before giving up at start-up (afterwards it reconnects forever). */
  readonly initialMaxRetries?: number;
  readonly topology?: Topology;
}

/** Declares exchanges, the dead-letter queue and this service's consumer queues. Idempotent. */
export async function assertTopology(model: ChannelModel, service: string, t: Topology = topology): Promise<void> {
  const channel = await model.createChannel();
  try {
    await channel.assertExchange(t.exchange.name, t.exchange.type, { durable: true });
    await channel.assertExchange(t.deadLetterExchange.name, t.deadLetterExchange.type, { durable: true });
    await channel.assertQueue(t.deadLetterQueue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await channel.bindQueue(t.deadLetterQueue, t.deadLetterExchange.name, '');
    for (const queue of t.queues.filter((q) => q.consumer === service)) {
      await channel.assertQueue(queue.name, {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-delivery-limit': t.deliveryLimit,
          'x-dead-letter-exchange': t.deadLetterExchange.name,
        },
      });
      await channel.bindQueue(queue.name, t.exchange.name, queue.routingKey);
    }
  } finally {
    await channel.close();
  }
}

export class Broker {
  private readonly options: BrokerOptions;
  private readonly attachments: BrokerAttachment[] = [];
  private model: amqp.RecoveringChannelModel | undefined;
  private connected = false;

  constructor(options: BrokerOptions) {
    this.options = options;
  }

  /** Registers a publisher or consumer; must be called before start(). */
  attach(attachment: BrokerAttachment): void {
    this.attachments.push(attachment);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    const { url, service, logger } = this.options;
    const model = await amqp.connect(url, {
      recovery: {
        initialDelay: 200,
        maxDelay: 10_000,
        maxRetries: Infinity,
        initialMaxRetries: this.options.initialMaxRetries ?? 10,
        waitForConnect: false,
        setup: async (raw: ChannelModel) => {
          await assertTopology(raw, service, this.options.topology);
          for (const attachment of this.attachments) {
            await attachment.attach(raw);
          }
        },
      },
    });
    this.model = model;
    model.on('connect', () => {
      this.connected = true;
      logger.info('broker connected');
    });
    model.on('disconnect', (error: Error) => {
      this.connected = false;
      logger.warn({ err: error }, 'broker disconnected, reconnecting');
    });
    model.on('reconnect-scheduled', ({ attempt, delay }: { attempt: number; delay: number }) =>
      logger.info({ attempt, delay_ms: delay }, 'broker reconnect scheduled'),
    );
    model.on('error', (error: Error) => logger.error({ err: error }, 'broker error'));
    model.on('handler-error', (error: Error) => logger.error({ err: error }, 'broker handler error'));
    await model.waitForConnect();
    this.connected = true;
  }

  /** Readiness check. */
  async check(): Promise<void> {
    if (!this.connected) {
      throw new Error('not connected to the broker');
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    await this.model?.close();
    this.model = undefined;
  }
}
