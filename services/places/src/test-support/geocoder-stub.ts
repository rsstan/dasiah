// Photon-compatible geocoder stand-in for the `full` Compose profile and the end-to-end tests:
// answers GET /api?q=&limit=&bbox= from a fixed list of testville addresses (fixtures/gtfs/
// testville), matching every word of the query. Nothing leaves the machine.
// Runnable on its own: `node src/test-support/geocoder-stub.ts` (PORT, default 2322).
import Fastify, { type FastifyInstance } from 'fastify';

interface Address {
  name?: string;
  street: string;
  housenumber?: string;
  lat: number;
  lon: number;
}

/** Next to the testville stops (the town is "Testville", inside the Warsaw bounds). */
export const ADDRESSES: readonly Address[] = [
  { name: 'Alpha Square', street: 'Alpha Square', housenumber: '1', lat: 52.2001, lon: 21.0003 },
  { street: 'Birch Street', housenumber: '4', lat: 52.2003, lon: 21.0151 },
  { name: 'Central Station', street: 'Station Road', housenumber: '1', lat: 52.2002, lon: 21.0302 },
  { street: 'Dock Lane', housenumber: '12', lat: 52.2001, lon: 21.0449 },
  { street: 'East End Avenue', housenumber: '7', lat: 52.2002, lon: 21.0598 },
  { street: 'Fern Hill', housenumber: '3', lat: 52.2091, lon: 21.0301 },
  { name: 'Grove Park', street: 'Grove Road', housenumber: '2', lat: 52.1911, lon: 21.0299 },
  { street: 'Harbour Quay', housenumber: '5', lat: 52.2016, lon: 21.0451 },
  { name: 'Meadow Farm', street: 'Meadow Way', housenumber: '9', lat: 52.1851, lon: 21.0001 },
];

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export function search(q: string, limit: number): Address[] {
  const wanted = words(q);
  return ADDRESSES.filter((a) => {
    const text = words(`${a.name ?? ''} ${a.street} ${a.housenumber ?? ''} testville`).join(' ');
    return wanted.every((w) => text.includes(w));
  }).slice(0, limit);
}

export async function startGeocoderStub(port = 0): Promise<{ url: string; app: FastifyInstance }> {
  const app = Fastify();
  app.get('/api', async (req) => {
    const { q = '', limit = '5' } = req.query as { q?: string; limit?: string };
    return {
      type: 'FeatureCollection',
      features: search(q, Number(limit)).map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: { ...a, city: 'Testville', country: 'Poland' },
      })),
    };
  });
  app.get('/health', async () => ({ status: 'ok' }));
  const url = await app.listen({ host: '0.0.0.0', port });
  return { url, app };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startGeocoderStub(Number(process.env['PORT'] ?? 2322));
  console.log(`geocoder stub listening at ${url}`);
}
