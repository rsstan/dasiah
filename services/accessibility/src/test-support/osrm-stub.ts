// Stand-in for OSRM's `table` service in tests and in the end-to-end stack without real road
// data: duration = straight-line distance x 1.4 at 36 km/h + 60 s, so cars are predictable.
// Runnable on its own: `node src/test-support/osrm-stub.ts` (PORT, default 5000).
import { haversineM } from '@heatmap/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { decodePolyline } from '../car/polyline.ts';

export interface OsrmStub {
  readonly url: string;
  /** Number of table requests answered. */
  requests: number;
  /** When set, every request answers this status. */
  failWith: number | undefined;
  /** Destinations (by index in the request) answered with null (no road). */
  readonly noRoute: Set<number>;
  close(): Promise<void>;
}

export function stubDuration(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return (haversineM(a, b) * 1.4) / 10 + 60;
}

export async function startOsrmStub(port = 0): Promise<OsrmStub> {
  // A 500-point polyline is a few kilobytes long.
  const app: FastifyInstance = Fastify({ maxParamLength: 65_536 });
  const stub: OsrmStub = {
    url: '',
    requests: 0,
    failWith: undefined,
    noRoute: new Set(),
    close: () => app.close(),
  };
  app.get('/table/v1/driving/:coordinates', async (req, reply) => {
    stub.requests++;
    if (stub.failWith !== undefined) {
      return reply.status(stub.failWith).send({ code: 'Error', message: 'stub failure' });
    }
    const raw = (req.params as { coordinates: string }).coordinates;
    const match = /^polyline\((.+)\)$/.exec(raw);
    const points = match?.[1] === undefined ? [] : decodePolyline(match[1]);
    const query = req.query as { sources?: string; annotations?: string };
    if (points.length < 2 || query.sources !== '0' || query.annotations !== 'duration') {
      return reply
        .status(400)
        .send({ code: 'InvalidQuery', message: 'expected polyline coordinates, sources=0, annotations=duration' });
    }
    const [lat0, lon0] = points[0] ?? [0, 0];
    const row = points.map(([lat, lon], i) =>
      i === 0 ? 0 : stub.noRoute.has(i - 1) ? null : stubDuration({ lat: lat0, lon: lon0 }, { lat, lon }),
    );
    return { code: 'Ok', durations: [row] };
  });
  (stub as { url: string }).url = await app.listen({ port, host: '0.0.0.0' });
  return stub;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stub = await startOsrmStub(Number(process.env['PORT'] ?? 5000));
  console.log(`OSRM stub listening at ${stub.url}`);
}
