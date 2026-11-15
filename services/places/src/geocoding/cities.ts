// Cities and their bounding boxes, from transit-data's public GET /cities (places owns no city
// data). Cached; refreshed in the background; the last good list keeps serving if transit-data
// is down.
import { HttpClient, type Logger } from '@heatmap/common';
import type { TransitDataApi } from '@heatmap/contracts';
import type { BoundingBox } from './geocoder.ts';

type City = TransitDataApi.components['schemas']['City'];

export class CityDirectory {
  private readonly http: HttpClient;
  private readonly logger: Logger;
  private readonly maxAgeMs: number;
  private cities = new Map<string, BoundingBox>();
  private fetchedAt = 0;
  private loading: Promise<void> | undefined;

  constructor(transitUrl: string, logger: Logger, maxAgeMs = 3_600_000) {
    this.http = new HttpClient({ name: 'transit-data', baseUrl: transitUrl, logger, timeoutMs: 5_000, retries: 2 });
    this.logger = logger;
    this.maxAgeMs = maxAgeMs;
  }

  /** Bounding box of a city; undefined when transit-data does not know it. */
  async bounds(code: string): Promise<BoundingBox | undefined> {
    if (this.fetchedAt === 0) {
      await this.refresh(); // first use: wait (throws if transit-data is unreachable)
    } else if (Date.now() - this.fetchedAt > this.maxAgeMs) {
      void this.refresh().catch((error: unknown) => this.logger.warn({ err: error }, 'city list refresh failed'));
    }
    return this.cities.get(code);
  }

  async refresh(): Promise<void> {
    this.loading ??= (async () => {
      const body = await this.http.getJson<{ items: City[] }>('/cities');
      this.cities = new Map(body.items.map((c) => [c.code, c.bounds]));
      this.fetchedAt = Date.now();
    })().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
}
