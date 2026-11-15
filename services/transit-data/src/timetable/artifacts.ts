// Artifacts served to accessibility (docs/05-algorithms.md#4):
// - timetable of one service date: stops, walking transfers, non-overtaking patterns; trips of
//   the previous day still running after midnight are included with times minus 86 400;
// - hex access: every cell of the feed's city with its centroid and access stops.
// The timetable of a (feed version, date) never changes, so it is built once, gzipped and
// kept in storage; the ETag is the hash of the content.
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { NotFoundError, UnprocessableError, withSpan, withTransaction, type Pool } from '@heatmap/common';
import type { AppContext } from '../context.ts';
import { buildPatterns, type Pattern } from './patterns.ts';

const gzipAsync = promisify(gzip);
const USABLE = ['validated', 'active', 'archived'];

export interface Artifact {
  /** gzip-compressed JSON. */
  readonly body: Buffer;
  readonly etag: string;
}

async function pack(value: unknown): Promise<Artifact> {
  const json = Buffer.from(JSON.stringify(value));
  const etag = `"${createHash('sha256').update(json).digest('base64url').slice(0, 27)}"`;
  return { body: await gzipAsync(json, { level: 6 }), etag };
}

async function usableVersion(pool: Pool, id: number): Promise<{ validFrom: string; validTo: string }> {
  const { rows } = await pool.query<{ status: string; valid_from: string | null; valid_to: string | null }>(
    'SELECT status, valid_from, valid_to FROM transit.feed_versions WHERE feed_version_id = $1',
    [id],
  );
  const v = rows[0];
  if (v === undefined || !USABLE.includes(v.status) || v.valid_from === null || v.valid_to === null) {
    throw new NotFoundError(`Feed version ${id} has no usable timetable.`);
  }
  return { validFrom: v.valid_from, validTo: v.valid_to };
}

export interface TimetableArtifact {
  version: 1;
  feedVersionId: number;
  date: string;
  stops: { id: number; lat: number; lon: number }[];
  transfers: [number, number, number][];
  patterns: Pattern[];
}

export async function buildTimetable(pool: Pool, feedVersionId: number, date: string): Promise<TimetableArtifact> {
  return withTransaction(pool, async (client) => {
    // The query needs most of a feed's stop_times: a sequential scan is expected
    // (docs/db/query-plans.md); enough memory keeps the aggregation off disk.
    await client.query(`SELECT set_config('statement_timeout', '300000', true), set_config('work_mem', '128MB', true)`);
    const trips = await client.query<{ route_id: number; stops: number[]; arr: number[]; dep: number[] }>(
      `WITH day_trips AS (
         SELECT t.trip_id, t.route_id, 0 AS shift
           FROM transit.service_dates sd
           JOIN transit.trips t ON t.feed_version_id = sd.feed_version_id AND t.service_id = sd.service_id
          WHERE sd.feed_version_id = $1 AND sd.service_date = $2::date
         UNION ALL
         SELECT t.trip_id, t.route_id, -86400
           FROM transit.service_dates sd
           JOIN transit.trips t ON t.feed_version_id = sd.feed_version_id AND t.service_id = sd.service_id
          WHERE sd.feed_version_id = $1 AND sd.service_date = $2::date - 1
            AND EXISTS (SELECT 1 FROM transit.stop_times x
                         WHERE x.feed_version_id = $1 AND x.trip_id = t.trip_id AND x.arrival_s >= 86400))
       SELECT d.route_id,
              array_agg(st.stop_id ORDER BY st.stop_sequence) AS stops,
              array_agg(st.arrival_s + d.shift ORDER BY st.stop_sequence) AS arr,
              array_agg(st.departure_s + d.shift ORDER BY st.stop_sequence) AS dep
         FROM day_trips d
         JOIN transit.stop_times st ON st.feed_version_id = $1 AND st.trip_id = d.trip_id
        GROUP BY d.trip_id, d.route_id, d.shift`,
      [feedVersionId, date],
    );
    const stops = await client.query<{ id: number; lat: number; lon: number }>(
      `SELECT stop_id AS id, round(ST_Y(geom::geometry)::numeric, 6)::float8 AS lat, round(ST_X(geom::geometry)::numeric, 6)::float8 AS lon
         FROM transit.stops WHERE feed_version_id = $1 ORDER BY stop_id`,
      [feedVersionId],
    );
    const transfers = await client.query<{ f: number; t: number; w: number }>(
      `SELECT from_stop_id AS f, to_stop_id AS t, walk_s AS w FROM transit.transfers
        WHERE feed_version_id = $1 ORDER BY from_stop_id, to_stop_id`,
      [feedVersionId],
    );
    const patterns = buildPatterns(
      trips.rows.map((r) => ({
        routeId: r.route_id,
        stops: r.stops,
        times: r.stops.flatMap((_, i) => [r.arr[i] ?? 0, r.dep[i] ?? 0]),
      })),
    );
    return {
      version: 1,
      feedVersionId,
      date,
      stops: stops.rows,
      transfers: transfers.rows.map((r) => [r.f, r.t, r.w]),
      patterns,
    };
  });
}

export class ArtifactStore {
  private readonly ctx: AppContext;
  private readonly inFlight = new Map<string, Promise<Artifact>>();

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  /** Timetable artifact of a date inside the feed's validity (built once, then from storage). */
  async timetable(feedVersionId: number, date: string): Promise<Artifact> {
    const version = await usableVersion(this.ctx.pool, feedVersionId);
    if (date < version.validFrom || date > version.validTo) {
      throw new UnprocessableError(
        `${date} is outside the validity of feed version ${feedVersionId} (${version.validFrom} to ${version.validTo}).`,
        {
          type: '/problems/date-outside-feed',
        },
      );
    }
    const key = `artifacts/${feedVersionId}/timetable-${date}.json.gz`;
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      return pending; // one build per artifact, however many requests ask for it
    }
    const work = (async () => {
      const cached = await this.ctx.storage.getBuffer(key);
      const etagKey = `${key}.etag`;
      const cachedEtag = await this.ctx.storage.getBuffer(etagKey);
      if (cached !== undefined && cachedEtag !== undefined) {
        return { body: cached, etag: cachedEtag.toString('utf8') };
      }
      const started = Date.now();
      const artifact = await withSpan(
        'timetable.build',
        async () => pack(await buildTimetable(this.ctx.pool, feedVersionId, date)),
        {
          'feed.version_id': feedVersionId,
        },
      );
      await this.ctx.storage.putBuffer(key, artifact.body);
      await this.ctx.storage.putBuffer(etagKey, Buffer.from(artifact.etag));
      this.ctx.logger.info(
        { feed_version_id: feedVersionId, date, bytes: artifact.body.length, ms: Date.now() - started },
        'timetable artifact built',
      );
      return artifact;
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  /** Cells of the feed's city with centroid and access stops; small, built on request. */
  async hexAccess(feedVersionId: number): Promise<Artifact> {
    await usableVersion(this.ctx.pool, feedVersionId);
    const { rows } = await this.ctx.pool.query<{
      city_code: string;
      resolution: number;
      h3: string;
      lat: number;
      lon: number;
      stops: number[];
      walks: number[];
    }>(
      `SELECT c.code AS city_code, c.h3_resolution AS resolution, h.h3_index AS h3,
              round(ST_Y(h.centroid::geometry)::numeric, 6)::float8 AS lat,
              round(ST_X(h.centroid::geometry)::numeric, 6)::float8 AS lon,
              coalesce(array_agg(a.stop_id ORDER BY a.walk_s, a.stop_id) FILTER (WHERE a.stop_id IS NOT NULL), '{}') AS stops,
              coalesce(array_agg(a.walk_s ORDER BY a.walk_s, a.stop_id) FILTER (WHERE a.stop_id IS NOT NULL), '{}') AS walks
         FROM transit.feed_versions v
         JOIN transit.feed_sources s ON s.feed_source_id = v.feed_source_id
         JOIN transit.cities c ON c.city_id = s.city_id
         JOIN transit.hex_cells h ON h.city_id = c.city_id
         LEFT JOIN transit.hex_stop_access a ON a.feed_version_id = v.feed_version_id AND a.h3_index = h.h3_index
        WHERE v.feed_version_id = $1
        GROUP BY c.code, c.h3_resolution, h.h3_index, h.centroid
        ORDER BY h.h3_index`,
      [feedVersionId],
    );
    const first = rows[0];
    if (first === undefined) {
      throw new NotFoundError(`The city of feed version ${feedVersionId} has no grid.`);
    }
    return pack({
      feedVersionId,
      cityCode: first.city_code,
      resolution: first.resolution,
      cells: rows.map((r) => ({
        h3: r.h3,
        lat: r.lat,
        lon: r.lon,
        stops: r.stops.map((s, i) => [s, r.walks[i] ?? 0]),
      })),
    });
  }
}
