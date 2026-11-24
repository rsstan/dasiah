// Timetable loading: start-up load, activation event, atomic swap, snapshot rows, readiness,
// a failing load keeps the previous snapshot.
import { randomUUID } from 'node:crypto';
import { topology } from '@heatmap/contracts';
import { captureLogger } from '@heatmap/common/testing';
import { eventually, startBroker, startDatabase, type TestBroker, type TestDatabase } from '@heatmap/testing';
import amqp from 'amqplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createService, type Service } from '../app.ts';
import { loadServiceConfig } from '../config.ts';
import { startTransitStub, type TransitStub } from '../test-support/transit-stub.ts';

let db: TestDatabase;
let broker: TestBroker;
let transit: TransitStub;
let service: Service;
let channel: amqp.Channel;
let connection: amqp.ChannelModel;
const captured = captureLogger('accessibility');

const feed = (feedVersionId: number) => ({
  feedVersionId,
  cityCode: 'waw',
  validFrom: '2026-11-01',
  validTo: '2027-03-31',
});

function publishActivated(feedVersionId: number): string {
  const id = randomUUID();
  const envelope = {
    id,
    type: 'transit.feed.activated.v1',
    source: 'transit-data',
    time: new Date().toISOString(),
    correlationId: `corr-activate-${feedVersionId}`,
    data: feed(feedVersionId),
  };
  channel.publish(topology.exchange.name, envelope.type, Buffer.from(JSON.stringify(envelope)), {
    messageId: id,
    persistent: true,
  });
  return id;
}

async function snapshotRows(): Promise<{ feed_version_id: number; is_current: boolean }[]> {
  const { rows } = await db.admin.query<{ feed_version_id: number; is_current: boolean }>(
    'SELECT feed_version_id, is_current FROM accessibility.feed_snapshots ORDER BY feed_version_id',
  );
  return rows;
}

beforeAll(async () => {
  [db, broker, transit] = await Promise.all([
    startDatabase({ services: ['accessibility'], referenceData: ['accessibility'] }),
    startBroker(),
    startTransitStub(),
  ]);
  transit.active.set('waw', feed(1)); // vno has no active feed
  const config = loadServiceConfig({
    SERVICE_NAME: 'accessibility',
    PORT: '3003',
    LOG_LEVEL: 'debug',
    DATABASE_URL: db.url('svc_accessibility'),
    AMQP_URL: broker.url,
    TRANSIT_URL: transit.url,
    CITIES: 'waw,vno',
    TRANSIT_TIMEOUT_MS: '2000',
    TIMETABLE_RETRY_MS: '200',
  });
  service = await createService(config, captured.logger);
  await service.app.ready();
  connection = await amqp.connect(broker.url);
  channel = await connection.createChannel();
});

afterAll(async () => {
  await service?.app.close();
  await connection?.close();
  await transit?.close();
  await Promise.all([db?.stop(), broker?.stop()]);
});

describe('timetable loading', () => {
  it('loads the active feed of each city at start-up and records the snapshot', async () => {
    const snapshot = service.ctx.timetables.current('waw');
    expect(snapshot).toMatchObject({ feedVersionId: 1, validFrom: '2026-11-01', validTo: '2027-03-31' });
    expect(snapshot?.cells.count).toBeGreaterThan(600);
    expect(service.ctx.timetables.current('vno')).toBeUndefined();
    expect(await snapshotRows()).toEqual([{ feed_version_id: 1, is_current: true }]);
    const ready = await service.app.inject('/health/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.timetable).toEqual({ status: 'ok' });
    expect(captured.lines.some((l) => l['msg'] === 'no active feed for the city yet' && l['city'] === 'vno')).toBe(
      true,
    );
  });

  it('loads a timetable of a date once and keeps it', async () => {
    const snapshot = service.ctx.timetables.current('waw');
    if (snapshot === undefined) {
      throw new Error('no snapshot');
    }
    const [a, b] = await Promise.all([
      service.ctx.timetables.timetable(snapshot, '2026-12-02'),
      service.ctx.timetables.timetable(snapshot, '2026-12-02'),
    ]);
    expect(a).toBe(b);
    expect(a.patternCount).toBe(8);
    expect(transit.requests.filter((u) => u.includes('timetable?date=2026-12-02'))).toHaveLength(1);
    await expect(service.ctx.timetables.timetable(snapshot, '2030-01-01')).rejects.toThrow(/No timetable/);
  });

  it('switches to a newly activated feed atomically when the event arrives', async () => {
    const before = service.ctx.timetables.current('waw');
    transit.active.set('waw', feed(2));
    publishActivated(2);
    await eventually('the new snapshot', () => service.ctx.timetables.current('waw')?.feedVersionId === 2);
    const after = service.ctx.timetables.current('waw');
    expect(after).not.toBe(before);
    expect(after?.cells.count).toBe(before?.cells.count);
    expect(await snapshotRows()).toEqual([
      { feed_version_id: 1, is_current: false },
      { feed_version_id: 2, is_current: true },
    ]);
    const handled = captured.lines.find(
      (l) => l['msg'] === 'timetable snapshot installed' && l['feed_version_id'] === 2,
    );
    expect(handled).toMatchObject({ correlation_id: 'corr-activate-2', replaced: 1 });
  });

  it('keeps serving the previous snapshot when the new one cannot be loaded', async () => {
    transit.broken.add(3);
    publishActivated(3);
    await eventually(
      'the load to be retried',
      () => captured.lines.filter((l) => l['msg'] === 'event handler failed, will retry').length >= 2,
    );
    expect(service.ctx.timetables.current('waw')?.feedVersionId).toBe(2);
    expect((await snapshotRows()).find((r) => r.is_current)?.feed_version_id).toBe(2);

    transit.broken.delete(3); // the publisher's next retry succeeds
    await eventually('the retried load', () => service.ctx.timetables.current('waw')?.feedVersionId === 3);
  });

  it('skips a duplicate delivery of the activation', async () => {
    const id = publishActivated(3);
    channel.publish(
      topology.exchange.name,
      'transit.feed.activated.v1',
      Buffer.from(
        JSON.stringify({
          id,
          type: 'transit.feed.activated.v1',
          source: 'transit-data',
          time: new Date().toISOString(),
          correlationId: null,
          data: feed(3),
        }),
      ),
      { messageId: id },
    );
    await eventually(
      'both deliveries',
      () => captured.lines.filter((l) => l['event_id'] === id && l['msg'] === 'event handled').length === 2,
    );
    expect(
      captured.lines
        .filter((l) => l['event_id'] === id)
        .map((l) => l['outcome'])
        .filter(Boolean)
        .sort(),
    ).toEqual(['duplicate', 'processed']);
    expect(service.ctx.timetables.current('waw')?.feedVersionId).toBe(3);
  });
});

describe('cities without a timetable', () => {
  it('are retried until their timetable loads (transit-data down at start-up, failing artifact)', async () => {
    expect(service.ctx.timetables.current('vno')).toBeUndefined();
    transit.broken.add(9);
    transit.active.set('vno', { ...feed(9), cityCode: 'vno' });
    await eventually(
      'failed retries',
      () =>
        captured.lines.filter((l) => l['msg'] === 'timetable of the city could not be loaded, will retry').length >= 2,
    );
    expect(service.ctx.timetables.current('vno')).toBeUndefined();

    transit.broken.delete(9);
    await eventually('vno loaded', () => service.ctx.timetables.current('vno')?.feedVersionId === 9);
    expect(service.ctx.timetables.current('waw')?.feedVersionId).toBe(3);
    const rows = await snapshotRows();
    expect(rows.filter((r) => r.is_current).map((r) => r.feed_version_id)).toEqual([3, 9]);
  });
});
