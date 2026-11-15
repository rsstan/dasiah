// POST /calculations and friends (docs/05-algorithms.md#9):
//   cache hit (done)        -> 200
//   same question running   -> 202 (single flight: unique partial index calculations_cache_uq)
//   otherwise               -> compute now under the bulkhead -> 201
// The results, the status `done` and accessibility.calculation.completed.v1 are written in one
// transaction. A failed computation is recorded as `failed` with an error code.
import { randomUUID } from 'node:crypto';
import { NotFoundError, ServiceUnavailableError, withSpan, withTransaction, type PoolClient } from '@heatmap/common';
import { bulkhead, BulkheadRejectedError, type BulkheadPolicy } from 'cockatiel';
import type { OsrmClient } from '../car/osrm.ts';
import type { AppContext } from '../context.ts';
import { raptor } from '../raptor/raptor.ts';
import { cellTimes, medianTimes } from './cells.ts';
import { departures, normalise, type CalculationInput, type NormalisedRequest } from './request.ts';

export interface CalculationView {
  calculationId: string;
  status: 'running' | 'done' | 'failed';
  cityCode: string;
  originH3: string;
  feedVersionId: number;
  date: string;
  time: string;
  windowMinutes: number;
  cellCount: number | null;
  durationMs: number | null;
  createdAt: string;
  expiresAt: string;
  errorCode: string | null;
}

export type CalculationOutcome =
  | { readonly kind: 'cached'; readonly calculation: CalculationView }
  | { readonly kind: 'computed'; readonly calculation: CalculationView }
  | { readonly kind: 'running'; readonly calculation: CalculationView };

interface Row {
  calculation_id: string;
  status: 'running' | 'done' | 'failed';
  city_code: string;
  origin_h3: string;
  feed_version_id: number;
  service_date: string;
  departure_s: number;
  window_s: number;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
  error_code: string | null;
  cell_count: number | null;
}

const SELECT = `
  SELECT c.calculation_id, c.status, s.city_code, c.origin_h3, c.feed_version_id, c.service_date, c.departure_s,
         c.window_s, c.created_at, c.completed_at, c.expires_at, c.error_code,
         CASE WHEN c.status = 'done'
              THEN (SELECT count(*) FROM accessibility.calculation_results r WHERE r.calculation_id = c.calculation_id) END AS cell_count
    FROM accessibility.calculations c
    JOIN accessibility.feed_snapshots s ON s.feed_version_id = c.feed_version_id`;

const pad = (n: number): string => String(n).padStart(2, '0');

function toView(row: Row): CalculationView {
  return {
    calculationId: row.calculation_id,
    status: row.status,
    cityCode: row.city_code,
    originH3: row.origin_h3,
    feedVersionId: row.feed_version_id,
    date: row.service_date,
    time: `${pad(Math.floor(row.departure_s / 3600))}:${pad(Math.floor((row.departure_s % 3600) / 60))}`,
    windowMinutes: row.window_s / 60,
    cellCount: row.cell_count,
    durationMs:
      row.completed_at === null || row.status !== 'done' ? null : row.completed_at.getTime() - row.created_at.getTime(),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    errorCode: row.error_code,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CalculationService {
  private readonly ctx: AppContext;
  private readonly osrm: ReadonlyMap<string, OsrmClient>;
  private readonly limiter: BulkheadPolicy;
  /** Results stay this long; the purge timer removes them afterwards. */
  private readonly ttlS = 86_400;

  constructor(ctx: AppContext, osrm: ReadonlyMap<string, OsrmClient>) {
    this.ctx = ctx;
    this.osrm = osrm;
    this.limiter = bulkhead(ctx.config.MAX_PARALLEL_CALCS, ctx.config.MAX_QUEUED_CALCS);
  }

  async get(id: string): Promise<CalculationView> {
    if (!UUID.test(id)) {
      throw new NotFoundError('No such calculation.');
    }
    const { rows } = await this.ctx.pool.query<Row>(`${SELECT} WHERE c.calculation_id = $1`, [id]);
    const row = rows[0];
    if (row === undefined) {
      throw new NotFoundError('No such calculation (it may have expired).');
    }
    return toView(row);
  }

  async request(input: CalculationInput, userId: string | undefined, now = new Date()): Promise<CalculationOutcome> {
    if (!this.ctx.config.CITIES.includes(input.cityCode)) {
      throw new NotFoundError(`Unknown city ${input.cityCode}.`, { type: '/problems/unknown-city' });
    }
    const snapshot = this.ctx.timetables.current(input.cityCode);
    if (snapshot === undefined) {
      throw new ServiceUnavailableError(`No timetable of ${input.cityCode} is loaded yet.`, 30, {
        type: '/problems/no-timetable',
      });
    }
    const req = normalise(input, snapshot, now);
    const key = [
      snapshot.feedVersionId,
      req.originH3,
      req.date,
      req.departureS,
      req.windowS,
      this.ctx.config.ALGO_VERSION,
    ];

    const cached = await this.findByKey(key);
    if (cached !== undefined) {
      if (userId !== undefined) {
        await this.publish(cached, userId, true);
      }
      return cached.status === 'done'
        ? { kind: 'cached', calculation: cached }
        : { kind: 'running', calculation: cached };
    }

    return this.compute(req, snapshot.feedVersionId, key, userId);
  }

  private async findByKey(key: unknown[]): Promise<CalculationView | undefined> {
    const { rows } = await this.ctx.pool.query<Row>(
      `${SELECT} WHERE c.feed_version_id = $1 AND c.origin_h3 = $2 AND c.service_date = $3 AND c.departure_s = $4
         AND c.window_s = $5 AND c.algo_version = $6 AND c.status IN ('running', 'done')`,
      key,
    );
    return rows[0] === undefined ? undefined : toView(rows[0]);
  }

  private async compute(
    req: NormalisedRequest,
    feedVersionId: number,
    key: unknown[],
    userId: string | undefined,
  ): Promise<CalculationOutcome> {
    const id = randomUUID();
    try {
      await this.ctx.pool.query(
        `INSERT INTO accessibility.calculations
           (calculation_id, feed_version_id, origin_h3, service_date, departure_s, window_s, algo_version, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
        [
          id,
          feedVersionId,
          req.originH3,
          req.date,
          req.departureS,
          req.windowS,
          this.ctx.config.ALGO_VERSION,
          this.ttlS,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        // Someone else started the same question a moment ago.
        const other = await this.findByKey(key);
        if (other !== undefined) {
          return other.status === 'done'
            ? { kind: 'cached', calculation: other }
            : { kind: 'running', calculation: other };
        }
      }
      throw error;
    }

    try {
      // The key is taken (row `running`) before waiting for a slot, so identical requests get 202.
      const { transitS, carS, hasStop, h3 } = await this.limiter
        .execute(() =>
          withSpan('calculation.compute', () => this.run(req), {
            'calculation.id': id,
            'calculation.city': req.cityCode,
          }),
        )
        .catch((error: unknown) => {
          if (error instanceof BulkheadRejectedError) {
            throw new ServiceUnavailableError('Too many maps are being computed right now.', 5, {
              type: '/problems/calculations-busy',
            });
          }
          throw error;
        });
      await withTransaction(this.ctx.pool, async (tx) => {
        await tx.query(
          `INSERT INTO accessibility.calculation_results (calculation_id, h3_index, transit_s, car_s, has_stop)
           SELECT $1, h, t, c, s FROM unnest($2::text[], $3::int[], $4::int[], $5::bool[]) AS u(h, t, c, s)`,
          [id, h3, transitS, carS, hasStop],
        );
        await tx.query(`UPDATE accessibility.calculations SET status = 'done' WHERE calculation_id = $1`, [id]);
        await this.writeEvent(tx, id, req.cityCode, req.originH3, userId ?? null, false);
      });
      this.ctx.outbox.wake();
    } catch (error) {
      const code = error instanceof ServiceUnavailableError ? errorCodeOf(error) : 'internal_error';
      await this.ctx.pool
        .query(`UPDATE accessibility.calculations SET status = 'failed', error_code = $2 WHERE calculation_id = $1`, [
          id,
          code,
        ])
        .catch((e: unknown) => this.ctx.logger.error({ err: e }, 'could not mark the calculation failed'));
      this.ctx.logger.warn({ calculation_id: id, error_code: code, err: error }, 'calculation failed');
      throw error;
    }
    const view = await this.get(id);
    this.ctx.logger.info(
      { calculation_id: id, city: req.cityCode, cells: view.cellCount, duration_ms: view.durationMs },
      'calculation done',
    );
    return { kind: 'computed', calculation: view };
  }

  /** RAPTOR (per departure of the window) and OSRM in parallel; per-cell results. */
  private async run(req: NormalisedRequest) {
    const snapshot = this.ctx.timetables.current(req.cityCode);
    if (snapshot === undefined) {
      throw new ServiceUnavailableError('The timetable was unloaded.', 30, { type: '/problems/no-timetable' });
    }
    const osrm = this.osrm.get(req.cityCode);
    if (osrm === undefined) {
      throw new ServiceUnavailableError(`Car routing for ${req.cityCode} is not configured.`, 60, {
        type: '/problems/car-routing-unavailable',
      });
    }
    const cells = snapshot.cells;
    const carPromise = osrm.carTimes(req.origin, cells.lat, cells.lon).catch((error: unknown) => {
      // A map with wrong car times would mislead: the calculation fails instead (cached maps keep working).
      const retry = error instanceof ServiceUnavailableError ? error.retryAfterS : undefined;
      throw new ServiceUnavailableError(
        `Car routing for ${req.cityCode} is unavailable.`,
        retry ?? 15,
        {
          type: '/problems/car-routing-unavailable',
        },
        { cause: error },
      );
    });
    carPromise.catch(() => undefined); // awaited below; avoid an unhandled rejection meanwhile
    const timetable = await this.ctx.timetables.timetable(snapshot, req.date).catch((error: unknown) => {
      throw new ServiceUnavailableError(
        'The timetable of this date cannot be loaded.',
        30,
        { type: '/problems/no-timetable' },
        { cause: error },
      );
    });
    const runs = await withSpan('raptor.query', async () =>
      departures(req).map((departure) => {
        const { arrival } = raptor(timetable, req.origin, departure);
        return cellTimes(cells, timetable, arrival, req.origin, departure);
      }),
    );
    const transitS = runs.length === 1 ? (runs[0]?.transitS ?? []) : medianTimes(runs.map((r) => r.transitS));
    const hasStop = runs[0]?.hasStop ?? [];
    const carS = await carPromise;
    return { transitS, carS, hasStop, h3: cells.h3 };
  }

  private async writeEvent(
    tx: PoolClient,
    calculationId: string,
    cityCode: string,
    originH3: string,
    userId: string | null,
    cacheHit: boolean,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO accessibility.outbox (event_type, payload) VALUES ('accessibility.calculation.completed.v1', $1)`,
      [{ calculationId, cityCode, originH3, userId, cacheHit }],
    );
  }

  /** A signed-in user asked a question that was already answered: history still records it. */
  private async publish(calculation: CalculationView, userId: string, cacheHit: boolean): Promise<void> {
    await withTransaction(this.ctx.pool, (tx) =>
      this.writeEvent(tx, calculation.calculationId, calculation.cityCode, calculation.originH3, userId, cacheHit),
    );
    this.ctx.outbox.wake();
  }

  /** Removes expired calculations (cascade to results); returns how many. */
  async purgeExpired(): Promise<number> {
    let total = 0;
    for (;;) {
      const { rows } = await this.ctx.pool.query<{ n: number }>('SELECT accessibility.purge_expired() AS n');
      const n = rows[0]?.n ?? 0;
      total += n;
      if (n < 500) {
        return total;
      }
    }
  }

  /** Calculations left `running` by a crash or restart can never finish. */
  async failInterrupted(olderThanS: number): Promise<number> {
    const { rowCount } = await this.ctx.pool.query(
      `UPDATE accessibility.calculations SET status = 'failed', error_code = 'interrupted'
        WHERE status = 'running' AND created_at < now() - make_interval(secs => $1)`,
      [olderThanS],
    );
    return rowCount ?? 0;
  }
}

function errorCodeOf(error: ServiceUnavailableError): string {
  switch (error.type) {
    case '/problems/car-routing-unavailable':
      return 'osrm_unavailable';
    case '/problems/no-timetable':
      return 'timetable_unavailable';
    case '/problems/calculations-busy':
      return 'busy';
    default:
      return 'upstream_unavailable';
  }
}
