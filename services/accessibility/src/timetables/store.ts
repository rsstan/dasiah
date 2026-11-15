// Timetables in memory, per city. A snapshot = one feed version of a city: its validity, the
// cells of the grid with their access stops, and a small LRU of timetables of single dates
// (built from the transit-data artifact on first use, one build at a time per date).
//
// Loading a new feed version builds the whole snapshot first and then replaces the reference
// in one assignment, so a calculation never sees half of a timetable; if loading fails, the
// previous snapshot keeps serving.
import { sql, type Kysely } from 'kysely';
import type { Logger } from '@heatmap/common';
import { buildTimetable, type Timetable } from '../raptor/timetable.ts';
import type { AccessibilityDb } from '../repositories/schema.ts';
import type { ActiveFeed, TransitClient } from './transit-client.ts';

export interface HexCells {
  readonly resolution: number;
  readonly count: number;
  readonly h3: readonly string[];
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  /** Access stops of cell c: accessStop/accessWalk[accessStart[c] .. accessStart[c + 1]) (artifact stop ids). */
  readonly accessStart: Int32Array;
  readonly accessStop: Int32Array;
  readonly accessWalk: Int32Array;
}

export interface Snapshot {
  readonly cityCode: string;
  readonly feedVersionId: number;
  readonly validFrom: string;
  readonly validTo: string;
  readonly cells: HexCells;
  readonly loadedAt: Date;
}

export class TimetableStore {
  private readonly transit: TransitClient;
  private readonly logger: Logger;
  private readonly cacheSize: number;
  private readonly snapshots = new Map<string, Snapshot>();
  /** key `${feedVersionId}:${date}`, insertion order = recency. */
  private readonly timetables = new Map<string, Promise<Timetable>>();

  constructor(transit: TransitClient, logger: Logger, cacheSize: number) {
    this.transit = transit;
    this.logger = logger;
    this.cacheSize = cacheSize;
  }

  current(cityCode: string): Snapshot | undefined {
    return this.snapshots.get(cityCode);
  }

  loadedCities(): string[] {
    return [...this.snapshots.keys()].sort();
  }

  /** Builds the snapshot of a feed version without installing it. */
  async build(feed: ActiveFeed): Promise<Snapshot> {
    const started = Date.now();
    const access = await this.transit.hexAccess(feed.feedVersionId);
    if (access.cityCode !== feed.cityCode) {
      throw new Error(`feed version ${feed.feedVersionId} belongs to ${access.cityCode}, not ${feed.cityCode}`);
    }
    const count = access.cells.length;
    const lat = new Float64Array(count);
    const lon = new Float64Array(count);
    const accessStart = new Int32Array(count + 1);
    const total = access.cells.reduce((n, c) => n + c.stops.length, 0);
    const accessStop = new Int32Array(total);
    const accessWalk = new Int32Array(total);
    let at = 0;
    access.cells.forEach((cell, i) => {
      lat[i] = cell.lat;
      lon[i] = cell.lon;
      accessStart[i] = at;
      for (const [stop, walk] of cell.stops) {
        accessStop[at] = stop;
        accessWalk[at] = walk;
        at++;
      }
    });
    accessStart[count] = at;
    const snapshot: Snapshot = {
      cityCode: feed.cityCode,
      feedVersionId: feed.feedVersionId,
      validFrom: feed.validFrom,
      validTo: feed.validTo,
      cells: {
        resolution: access.resolution,
        count,
        h3: access.cells.map((c) => c.h3),
        lat,
        lon,
        accessStart,
        accessStop,
        accessWalk,
      },
      loadedAt: new Date(),
    };
    this.logger.info(
      {
        city: feed.cityCode,
        feed_version_id: feed.feedVersionId,
        cells: count,
        access_stops: total,
        ms: Date.now() - started,
      },
      'timetable snapshot built',
    );
    return snapshot;
  }

  /** Installs a built snapshot (atomic for readers: one Map assignment). */
  install(snapshot: Snapshot): void {
    const previous = this.snapshots.get(snapshot.cityCode);
    this.snapshots.set(snapshot.cityCode, snapshot);
    if (previous !== undefined && previous.feedVersionId !== snapshot.feedVersionId) {
      for (const key of [...this.timetables.keys()].filter((k) => k.startsWith(`${previous.feedVersionId}:`))) {
        this.timetables.delete(key);
      }
    }
    this.logger.info(
      { city: snapshot.cityCode, feed_version_id: snapshot.feedVersionId, replaced: previous?.feedVersionId ?? null },
      'timetable snapshot installed',
    );
  }

  /** Timetable of one service date of a snapshot (cached, built once). */
  async timetable(snapshot: Snapshot, date: string): Promise<Timetable> {
    const key = `${snapshot.feedVersionId}:${date}`;
    const cached = this.timetables.get(key);
    if (cached !== undefined) {
      this.timetables.delete(key);
      this.timetables.set(key, cached);
      return cached;
    }
    const loading = (async () => {
      const started = Date.now();
      const timetable = buildTimetable(await this.transit.timetable(snapshot.feedVersionId, date));
      this.logger.info(
        { feed_version_id: snapshot.feedVersionId, date, patterns: timetable.patternCount, ms: Date.now() - started },
        'timetable of a date loaded',
      );
      return timetable;
    })();
    loading.catch(() => this.timetables.delete(key)); // a failed load is not cached
    this.timetables.set(key, loading);
    while (this.timetables.size > this.cacheSize) {
      const oldest = this.timetables.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.timetables.delete(oldest);
    }
    return loading;
  }
}

/** Records a loaded snapshot as the current one of its city (the trigger clears the previous). */
export async function recordSnapshot(db: Kysely<AccessibilityDb>, snapshot: Snapshot): Promise<void> {
  await db
    .insertInto('accessibility.feed_snapshots')
    .values({
      feed_version_id: snapshot.feedVersionId,
      city_code: snapshot.cityCode,
      valid_from: snapshot.validFrom,
      valid_to: snapshot.validTo,
      is_current: true,
    })
    .onConflict((oc) => oc.column('feed_version_id').doUpdateSet({ is_current: true, loaded_at: sql<Date>`now()` }))
    .execute();
}
