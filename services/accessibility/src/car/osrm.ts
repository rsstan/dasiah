// Car times from OSRM (docs/05-algorithms.md#7): `table` from the origin to every cell centre of
// the city, in chunks of at most 500 destinations, a few chunks in parallel, each through the
// city's resilient client (timeout, retries for the GET, one circuit breaker per city). With
// minIntervalMs (the public demo server allows one request per second) requests of the city are
// spaced at least that far apart, across all calculations.
//   car_s = round(duration x CAR_TIME_FACTOR) + CAR_OVERHEAD_S, at least 60 s; null stays null.
// If any chunk fails the whole result fails: a partial car map is never used.
import { HttpClient, ServiceUnavailableError, withSpan, type Logger } from '@heatmap/common';
import { encodePolyline } from './polyline.ts';

export interface OsrmOptions {
  readonly chunkSize?: number;
  readonly parallel?: number;
  readonly timeoutMs?: number;
  readonly factor?: number;
  readonly overheadS?: number;
  /** Minimum gap between two table requests to this server; 0 = no pacing. */
  readonly minIntervalMs?: number;
}

interface TableResponse {
  code: string;
  message?: string;
  durations?: (number | null)[][];
}

export const MIN_CAR_S = 60;

export class OsrmClient {
  private readonly http: HttpClient;
  private readonly chunkSize: number;
  private readonly parallel: number;
  private readonly factor: number;
  private readonly overheadS: number;
  private readonly minIntervalMs: number;
  /** Earliest time the next table request may start. */
  private nextAt = 0;
  readonly city: string;

  constructor(city: string, baseUrl: string, logger: Logger, options: OsrmOptions = {}) {
    this.city = city;
    this.chunkSize = options.chunkSize ?? 500;
    this.parallel = options.parallel ?? 4;
    this.factor = options.factor ?? 1;
    this.overheadS = options.overheadS ?? 0;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.http = new HttpClient({
      name: `osrm-${city}`,
      baseUrl,
      logger,
      timeoutMs: options.timeoutMs ?? 10_000,
      retries: 2,
      breakerThreshold: 5,
      breakerHalfOpenAfterMs: 15_000,
      // Identifies the application, as the public OSRM demo server's usage policy asks.
      headers: { 'user-agent': 'transit-heatmap/1.0' },
    });
  }

  get circuitState(): string {
    return this.http.circuitState;
  }

  /** Car seconds from `origin` to each destination (same order); null where OSRM finds no route. */
  async carTimes(
    origin: { lat: number; lon: number },
    destLat: Float64Array,
    destLon: Float64Array,
  ): Promise<(number | null)[]> {
    const count = destLat.length;
    const chunks: [number, number][] = [];
    for (let start = 0; start < count; start += this.chunkSize) {
      chunks.push([start, Math.min(count, start + this.chunkSize)]);
    }
    const result = new Array<number | null>(count).fill(null);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        if (chunk === undefined) {
          return;
        }
        const [from, to] = chunk;
        const durations = await this.chunk(origin, destLat, destLon, from, to);
        for (let i = from; i < to; i++) {
          const d = durations[i - from + 1];
          result[i] =
            d === null || d === undefined ? null : Math.max(MIN_CAR_S, Math.round(d * this.factor) + this.overheadS);
        }
      }
    };
    await withSpan(
      'osrm.table.batch',
      () => Promise.all(Array.from({ length: Math.min(this.parallel, chunks.length) }, worker)),
      { 'osrm.city': this.city, 'osrm.destinations': count, 'osrm.chunks': chunks.length },
    );
    return result;
  }

  private async chunk(
    origin: { lat: number; lon: number },
    destLat: Float64Array,
    destLon: Float64Array,
    from: number,
    to: number,
  ): Promise<(number | null)[]> {
    const points: [number, number][] = [[origin.lat, origin.lon]];
    for (let i = from; i < to; i++) {
      points.push([destLat[i] ?? 0, destLon[i] ?? 0]);
    }
    await this.pace();
    const path = `/table/v1/driving/polyline(${encodeURIComponent(encodePolyline(points))})`;
    const res = await this.http.request<TableResponse>('GET', path, { query: { sources: 0, annotations: 'duration' } });
    const row = res.body?.durations?.[0];
    if (res.status !== 200 || res.body?.code !== 'Ok' || row === undefined || row.length !== points.length) {
      throw new ServiceUnavailableError(
        `OSRM ${this.city} answered ${res.status} ${res.body?.code ?? ''} ${res.body?.message ?? ''}`.trim(),
        15,
        {
          type: '/problems/car-routing-unavailable',
        },
      );
    }
    return row;
  }

  /** Waits for this request's slot when requests are paced. */
  private async pace(): Promise<void> {
    if (this.minIntervalMs === 0) {
      return;
    }
    const now = Date.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.minIntervalMs;
    if (at > now) {
      await new Promise((resolve) => setTimeout(resolve, at - now));
    }
  }
}
