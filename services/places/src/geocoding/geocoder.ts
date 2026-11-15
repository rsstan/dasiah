// Geocoder behind an interface (decision D9): Photon (default, public instance in development)
// or Nominatim, both limited to the city's bounding box. Calls are throttled to one per
// GEOCODER_MIN_INTERVAL_MS and go through the resilient client (timeout, retries, breaker).
import { HttpClient, type Logger } from '@heatmap/common';

export interface BoundingBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface Candidate {
  readonly displayName: string;
  readonly lat: number;
  readonly lon: number;
}

export interface Geocoder {
  readonly provider: 'photon' | 'nominatim';
  search(query: string, bounds: BoundingBox, limit: number): Promise<Candidate[]>;
}

/** Spaces requests at least `intervalMs` apart, in arrival order. */
export class Throttle {
  private readonly intervalMs: number;
  private next = 0;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) {
      await new Promise((r) => setTimeout(r, at - now));
    }
  }
}

const inside = (b: BoundingBox, c: Candidate): boolean =>
  c.lat >= b.south && c.lat <= b.north && c.lon >= b.west && c.lon <= b.east;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
}

/** "Street 12, District, City" from Photon's address parts. */
export function photonName(p: Record<string, string | undefined>): string {
  const street = p['street'] !== undefined ? [p['street'], p['housenumber']].filter(Boolean).join(' ') : undefined;
  const parts = [p['name'] !== street ? p['name'] : undefined, street, p['district'] ?? p['locality'], p['city']];
  return [...new Set(parts.filter((x): x is string => x !== undefined && x !== ''))].join(', ');
}

export class PhotonGeocoder implements Geocoder {
  readonly provider = 'photon' as const;
  private readonly http: HttpClient;
  private readonly throttle: Throttle;

  constructor(baseUrl: string, logger: Logger, options: { minIntervalMs: number; timeoutMs: number }) {
    this.http = new HttpClient({
      name: 'geocoder',
      baseUrl,
      logger,
      timeoutMs: options.timeoutMs,
      retries: 1,
      headers: { 'user-agent': 'transit-heatmap/1.0' },
    });
    this.throttle = new Throttle(options.minIntervalMs);
  }

  async search(query: string, bounds: BoundingBox, limit: number): Promise<Candidate[]> {
    await this.throttle.wait();
    const body = await this.http.getJson<{ features?: PhotonFeature[] }>('/api', {
      query: { q: query, limit, bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}` },
    });
    return (body.features ?? [])
      .flatMap((f) => {
        const [lon, lat] = f.geometry?.coordinates ?? [];
        const name = photonName(f.properties ?? {});
        return lat === undefined || lon === undefined || name === '' ? [] : [{ displayName: name, lat, lon }];
      })
      .filter((c) => inside(bounds, c))
      .slice(0, limit);
  }
}

export class NominatimGeocoder implements Geocoder {
  readonly provider = 'nominatim' as const;
  private readonly http: HttpClient;
  private readonly throttle: Throttle;

  constructor(baseUrl: string, logger: Logger, options: { minIntervalMs: number; timeoutMs: number }) {
    this.http = new HttpClient({
      name: 'geocoder',
      baseUrl,
      logger,
      timeoutMs: options.timeoutMs,
      retries: 1,
      headers: { 'user-agent': 'transit-heatmap/1.0' },
    });
    this.throttle = new Throttle(options.minIntervalMs);
  }

  async search(query: string, bounds: BoundingBox, limit: number): Promise<Candidate[]> {
    await this.throttle.wait();
    const rows = await this.http.getJson<{ display_name: string; lat: string; lon: string }[]>('/search', {
      query: {
        q: query,
        format: 'jsonv2',
        limit,
        bounded: 1,
        viewbox: `${bounds.west},${bounds.north},${bounds.east},${bounds.south}`,
      },
    });
    return rows
      .map((r) => ({ displayName: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }))
      .filter((c) => Number.isFinite(c.lat) && inside(bounds, c))
      .slice(0, limit);
  }
}
