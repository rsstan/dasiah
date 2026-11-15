// GTFS import, raw -> staging -> core -> mart:
//   1. download (or take a local file) and hash; the same archive of a source is a no-op;
//   2. store the zip under raw/<source>/<sha256>.zip; feed_versions row `downloaded`;
//   3. COPY the files into transit_staging; `staged`;
//   4. quality checks on staging; then in ONE transaction promote_feed (typed core tables and
//      quality gates), rebuild_transfers, rebuild_hex_stop_access; `validated`.
// Any failure rolls the current step back, marks the version `failed` with the reason and
// empties its staging rows: nothing of a broken feed reaches the core tables.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictError, NotFoundError, withSpan, withTransaction, type PoolClient } from '@heatmap/common';
import { sql } from 'kysely';
import type { AppContext } from '../context.ts';
import { STAGED_FILES } from '../repositories/schema.ts';
import { downloadToFile, hashFile } from './download.ts';
import { stageArchive } from './staging.ts';

export interface ImportStarted {
  readonly feedVersionId: number;
  readonly status: string;
  readonly duplicate: boolean;
  /** Resolves when the background part is over (always resolves; see the version's status). */
  readonly done: Promise<void>;
}

interface Source {
  feedSourceId: number;
  code: string;
  url: string;
  cityId: number;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const STAGING_TABLES = Object.values(STAGED_FILES);

async function setLocal(client: PoolClient, name: 'statement_timeout' | 'work_mem', value: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [name, value]);
}

export class Importer {
  private readonly ctx: AppContext;
  private readonly running = new Set<number>();

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  /** Versions left `downloaded` or `staged` by a crash or restart can never finish: mark them failed. */
  async failInterrupted(): Promise<number> {
    const result = await this.ctx.db
      .updateTable('transit.feed_versions')
      .set({ status: 'failed', error_message: 'import interrupted (service restarted)' })
      .where('status', 'in', ['downloaded', 'staged'])
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async importFromUrl(sourceCode: string): Promise<ImportStarted> {
    const source = await this.source(sourceCode);
    return this.withArchive(source, async (file) => {
      this.ctx.logger.info({ source: source.code }, 'downloading feed');
      const started = Date.now();
      const downloaded = await downloadToFile(source.url, file, {
        timeoutMs: this.ctx.config.DOWNLOAD_TIMEOUT_MS,
        maxBytes: this.ctx.config.MAX_DOWNLOAD_BYTES,
        logger: this.ctx.logger,
      });
      this.ctx.logger.info(
        { source: source.code, bytes: downloaded.bytes, ms: Date.now() - started },
        'feed downloaded',
      );
      return downloaded;
    });
  }

  async importFromFile(sourceCode: string, path: string): Promise<ImportStarted> {
    const source = await this.source(sourceCode);
    return this.withArchive(
      source,
      async (file) => {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(path, file);
        return hashFile(file);
      },
      path,
    );
  }

  private async source(code: string): Promise<Source> {
    const source = await this.ctx.db
      .selectFrom('transit.feed_sources')
      .select(['feed_source_id as feedSourceId', 'code', 'url', 'city_id as cityId'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (source === undefined) {
      throw new NotFoundError(`Unknown feed source ${code}.`);
    }
    return source;
  }

  private async withArchive(
    source: Source,
    fetch: (file: string) => Promise<{ sha256: Buffer; bytes: number }>,
    origin?: string,
  ): Promise<ImportStarted> {
    if (this.running.has(source.feedSourceId)) {
      throw new ConflictError(`An import of ${source.code} is already running.`, { type: '/problems/import-running' });
    }
    this.running.add(source.feedSourceId);
    const dir = await mkdtemp(join(tmpdir(), 'gtfs-'));
    const file = join(dir, 'feed.zip');
    let handedOver = false;
    try {
      const { sha256, bytes } = await fetch(file);
      const registered = await this.register(source, sha256, file, origin);
      if (registered.duplicate) {
        this.ctx.logger.info(
          { source: source.code, feed_version_id: registered.feedVersionId },
          'same archive as before, nothing to import',
        );
        return { ...registered, done: Promise.resolve() };
      }
      this.ctx.logger.info(
        { source: source.code, feed_version_id: registered.feedVersionId, bytes },
        'feed registered',
      );
      handedOver = true;
      const done = this.process(registered.feedVersionId, source, file).finally(async () => {
        this.running.delete(source.feedSourceId);
        await rm(dir, { recursive: true, force: true });
      });
      return { ...registered, done };
    } finally {
      if (!handedOver) {
        this.running.delete(source.feedSourceId);
        await rm(dir, { recursive: true, force: true });
      }
    }
  }

  private async register(
    source: Source,
    sha256: Buffer,
    file: string,
    origin: string | undefined,
  ): Promise<{ feedVersionId: number; status: string; duplicate: boolean }> {
    const existing = await this.ctx.db
      .selectFrom('transit.feed_versions')
      .select(['feed_version_id', 'status'])
      .where('feed_source_id', '=', source.feedSourceId)
      .where('sha256', '=', sha256)
      .executeTakeFirst();
    if (existing !== undefined && existing.status !== 'failed') {
      return { feedVersionId: existing.feed_version_id, status: existing.status, duplicate: true };
    }
    if (existing !== undefined) {
      // A failed attempt of the same archive is replaced (it left nothing in the core tables).
      await this.ctx.db
        .deleteFrom('transit.feed_versions')
        .where('feed_version_id', '=', existing.feed_version_id)
        .execute();
    }
    const key = `raw/${source.code}/${sha256.toString('hex')}.zip`;
    await this.ctx.storage.putFile(key, file);
    const row = await this.ctx.db
      .insertInto('transit.feed_versions')
      .values({ feed_source_id: source.feedSourceId, sha256, storage_key: key })
      .returning(['feed_version_id', 'status'])
      .executeTakeFirstOrThrow();
    if (origin !== undefined) {
      this.ctx.logger.info({ feed_version_id: row.feed_version_id, file: origin }, 'imported from a local file');
    }
    return { feedVersionId: row.feed_version_id, status: row.status, duplicate: false };
  }

  private async process(feedVersionId: number, source: Source, file: string): Promise<void> {
    const { logger, pool, config } = this.ctx;
    const timings: Record<string, number> = {};
    const timed = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await withSpan(`gtfs.${step}`, fn, { 'feed.version_id': feedVersionId });
      } finally {
        timings[`${step}_ms`] = Date.now() - started;
      }
    };
    try {
      const staged = await timed('copy', () =>
        withTransaction(pool, async (client) => {
          await setLocal(client, 'statement_timeout', String(config.IMPORT_STATEMENT_TIMEOUT_MS));
          const counts = await stageArchive(client, feedVersionId, file);
          await client.query(`UPDATE transit.feed_versions SET status = 'staged' WHERE feed_version_id = $1`, [
            feedVersionId,
          ]);
          return counts;
        }),
      );
      logger.info({ feed_version_id: feedVersionId, staged }, 'feed staged');

      await timed('checks', () => this.checkStaging(feedVersionId, source));

      const core = await timed('promote', () =>
        withTransaction(pool, async (client) => {
          await setLocal(client, 'statement_timeout', String(config.IMPORT_STATEMENT_TIMEOUT_MS));
          await setLocal(client, 'work_mem', '128MB');
          await client.query('CALL transit.promote_feed($1)', [feedVersionId]);
          // Statistics for the rows just added (visible to ANALYZE in this transaction), so the
          // next steps and the first timetable export get sensible plans.
          await client.query('SELECT transit.analyze_feed_tables()');
          await client.query('CALL transit.rebuild_transfers($1)', [feedVersionId]);
          await client.query('CALL transit.rebuild_hex_stop_access($1)', [feedVersionId]);
          await client.query('SELECT transit.analyze_feed_tables()');
          const { rows } = await client.query<Record<string, number>>(
            `SELECT (SELECT count(*) FROM transit.agencies WHERE feed_version_id = $1) AS agencies,
                    (SELECT count(*) FROM transit.routes WHERE feed_version_id = $1) AS routes,
                    (SELECT count(*) FROM transit.stops WHERE feed_version_id = $1) AS stops,
                    (SELECT count(*) FROM transit.trips WHERE feed_version_id = $1) AS trips,
                    (SELECT count(*) FROM transit.stop_times WHERE feed_version_id = $1) AS stop_times,
                    (SELECT count(*) FROM transit.service_dates WHERE feed_version_id = $1) AS service_dates,
                    (SELECT count(*) FROM transit.transfers WHERE feed_version_id = $1) AS transfers,
                    (SELECT count(*) FROM transit.hex_stop_access WHERE feed_version_id = $1) AS hex_stop_access`,
            [feedVersionId],
          );
          return rows[0];
        }),
      );
      logger.info({ feed_version_id: feedVersionId, source: source.code, rows: core, ...timings }, 'feed validated');
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
      logger.error(
        { feed_version_id: feedVersionId, source: source.code, err: error, ...timings },
        'feed import failed',
      );
      await this.markFailed(feedVersionId, reason);
    }
  }

  /** Checks of docs/05-algorithms.md that promote_feed does not do: warnings, failure above a threshold. */
  private async checkStaging(feedVersionId: number, source: Source): Promise<void> {
    const { rows } = await sql<{ stops: number; outside: number; short_trips: number }>`
      SELECT
        (SELECT count(*) FROM transit_staging.stops s WHERE s.feed_version_id = ${feedVersionId}
           AND coalesce(nullif(btrim(s.location_type), ''), '0') = '0') AS stops,
        (SELECT count(*) FROM transit_staging.stops s, transit.cities c
          WHERE s.feed_version_id = ${feedVersionId} AND c.city_id = ${source.cityId}
            AND coalesce(nullif(btrim(s.location_type), ''), '0') = '0'
            AND NOT ST_DWithin(c.bounds::geography,
                               ST_SetSRID(ST_MakePoint(s.stop_lon::float8, s.stop_lat::float8), 4326)::geography, 1500)) AS outside,
        (SELECT count(*) FROM (SELECT trip_id FROM transit_staging.stop_times WHERE feed_version_id = ${feedVersionId}
                               GROUP BY trip_id HAVING count(*) < 2) t) AS short_trips`.execute(this.ctx.db);
    const check = rows[0];
    if (check === undefined) {
      return;
    }
    const share = check.stops === 0 ? 0 : check.outside / check.stops;
    if (check.outside > 0 || check.short_trips > 0) {
      this.ctx.logger.warn(
        {
          feed_version_id: feedVersionId,
          stops: check.stops,
          stops_outside_city: check.outside,
          trips_with_one_stop: check.short_trips,
        },
        'feed quality warnings',
      );
    }
    if (share > this.ctx.config.MAX_STOPS_OUTSIDE_SHARE) {
      throw new ImportError(
        `${check.outside} of ${check.stops} stops lie outside the city bounds (more than ${this.ctx.config.MAX_STOPS_OUTSIDE_SHARE * 100} %): wrong feed for this city?`,
      );
    }
  }

  private async markFailed(feedVersionId: number, reason: string): Promise<void> {
    try {
      await withTransaction(this.ctx.pool, async (client) => {
        for (const table of STAGING_TABLES) {
          await client.query(`DELETE FROM transit_staging.${table} WHERE feed_version_id = $1`, [feedVersionId]);
        }
        await client.query(
          `UPDATE transit.feed_versions SET status = 'failed', error_message = $2 WHERE feed_version_id = $1`,
          [feedVersionId, reason],
        );
      });
    } catch (error) {
      this.ctx.logger.error(
        { feed_version_id: feedVersionId, err: error },
        'could not mark the feed version as failed',
      );
    }
  }
}
