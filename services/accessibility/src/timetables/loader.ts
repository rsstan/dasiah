// Getting timetables into memory: at start-up for every configured city, and on
// transit.feed.activated.v1 (consumer, inbox transaction).
import type { EventHandlers, Logger, PoolClient } from '@heatmap/common';
import type { Snapshot, TimetableStore } from './store.ts';
import type { TransitClient } from './transit-client.ts';

const UPSERT_SNAPSHOT = `
  INSERT INTO accessibility.feed_snapshots (feed_version_id, city_code, valid_from, valid_to, is_current)
  VALUES ($1, $2, $3, $4, true)
  ON CONFLICT (feed_version_id) DO UPDATE SET is_current = true, loaded_at = now()`;

async function record(client: PoolClient, s: Snapshot): Promise<void> {
  await client.query(UPSERT_SNAPSHOT, [s.feedVersionId, s.cityCode, s.validFrom, s.validTo]);
}

export class TimetableLoader {
  private readonly store: TimetableStore;
  private readonly transit: TransitClient;
  private readonly logger: Logger;

  constructor(store: TimetableStore, transit: TransitClient, logger: Logger) {
    this.store = store;
    this.transit = transit;
    this.logger = logger;
  }

  /**
   * Loads the active feed of every city that has no timetable yet. A city without an active
   * feed, or whose load fails, is skipped with a log line; the service starts anyway, readiness
   * reports what is loaded, and `retryMissing` tries again later.
   */
  async loadAll(cities: readonly string[], connect: () => Promise<PoolClient>, retry = false): Promise<void> {
    for (const city of cities) {
      if (this.store.current(city) !== undefined) {
        continue;
      }
      try {
        const feed = await this.transit.activeFeed(city);
        if (feed === undefined) {
          this.logger[retry ? 'debug' : 'warn']({ city }, 'no active feed for the city yet');
          continue;
        }
        const snapshot = await this.store.build(feed);
        if (this.store.current(city) !== undefined) {
          continue; // the activation event was faster; never replace a newer snapshot
        }
        const client = await connect();
        try {
          await record(client, snapshot);
        } finally {
          client.release();
        }
        this.store.install(snapshot);
      } catch (error) {
        this.logger[retry ? 'warn' : 'error'](
          { city, err: error },
          retry
            ? 'timetable of the city could not be loaded, will retry'
            : 'timetable of the city could not be loaded at start-up',
        );
      }
    }
  }

  /**
   * Keeps trying cities that still have no timetable (transit-data was down at start-up, or a
   * load failed), every `intervalMs`, one round at a time. Returns a function that stops it.
   */
  retryMissing(cities: readonly string[], connect: () => Promise<PoolClient>, intervalMs: number): () => void {
    let running = false;
    const timer = setInterval(() => {
      const missing = cities.filter((c) => this.store.current(c) === undefined);
      if (running || missing.length === 0) {
        return;
      }
      running = true;
      void this.loadAll(missing, connect, true).finally(() => {
        running = false;
      });
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  /**
   * Consumer of transit.feed.activated.v1: build, record (same transaction as the inbox row) and,
   * once that is committed, install. Installing earlier would serve a feed version that has no
   * snapshot row yet, or never gets one when the commit fails.
   */
  handlers(cities: readonly string[]): EventHandlers {
    return {
      'transit.feed.activated.v1': async (event, tx, afterCommit) => {
        const feed = event.data;
        if (!cities.includes(feed.cityCode)) {
          this.logger.info({ city: feed.cityCode }, 'feed of a city this instance does not serve; ignored');
          return;
        }
        const current = this.store.current(feed.cityCode);
        if (current !== undefined && current.feedVersionId === feed.feedVersionId) {
          await record(tx, current);
          return;
        }
        // On failure this throws: the message is retried and the previous snapshot keeps serving.
        const snapshot = await this.store.build(feed);
        await record(tx, snapshot);
        afterCommit(() => this.store.install(snapshot));
      },
    };
  }
}
