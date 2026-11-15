// Client of the internal API of transit-data (contracts/openapi/transit-data.yaml): timeout,
// retries for these idempotent GETs, circuit breaker, correlation id (HttpClient).
import { HttpClient, NotFoundError, UpstreamError, type Logger } from '@heatmap/common';
import type { TransitDataApi } from '@heatmap/contracts';
import type { TimetableArtifact } from '../raptor/timetable.ts';

export type ActiveFeed = TransitDataApi.components['schemas']['ActiveFeed'];
export type HexAccessArtifact = TransitDataApi.components['schemas']['HexAccess'];

export class TransitClient {
  private readonly http: HttpClient;

  constructor(baseUrl: string, logger: Logger, timeoutMs: number) {
    this.http = new HttpClient({ name: 'transit-data', baseUrl, logger, timeoutMs, retries: 2 });
  }

  /** undefined when the city has no active feed. */
  async activeFeed(cityCode: string): Promise<ActiveFeed | undefined> {
    const res = await this.http.request<ActiveFeed>(
      'GET',
      `/internal/cities/${encodeURIComponent(cityCode)}/active-feed`,
    );
    if (res.status === 404) {
      return undefined;
    }
    return this.ok(res, 'active feed');
  }

  async timetable(feedVersionId: number, date: string): Promise<TimetableArtifact> {
    const res = await this.http.request<TimetableArtifact>(
      'GET',
      `/internal/feed-versions/${feedVersionId}/timetable`,
      {
        query: { date },
        headers: { 'accept-encoding': 'gzip' },
      },
    );
    if (res.status === 404 || res.status === 422) {
      throw new NotFoundError(`No timetable of feed version ${feedVersionId} for ${date}.`);
    }
    return this.ok(res, 'timetable');
  }

  async hexAccess(feedVersionId: number): Promise<HexAccessArtifact> {
    const res = await this.http.request<HexAccessArtifact>(
      'GET',
      `/internal/feed-versions/${feedVersionId}/hex-access`,
      {
        headers: { 'accept-encoding': 'gzip' },
      },
    );
    return this.ok(res, 'hex access');
  }

  private ok<T>(res: { status: number; body: T }, what: string): T {
    if (res.status !== 200) {
      throw new UpstreamError(
        `transit-data answered ${res.status} for the ${what}`,
        'transit-data',
        res.status,
        res.body,
      );
    }
    return res.body;
  }
}
