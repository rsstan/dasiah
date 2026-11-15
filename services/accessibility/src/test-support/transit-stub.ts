// Stand-in for the internal API of transit-data in accessibility's tests. It serves the testville
// artifacts that transit-data really builds (fixtures/gtfs/testville/artifacts, kept in sync by
// transit-data.itest.ts) under any feed version id.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

const ARTIFACTS = resolve(import.meta.dirname, '../../../../fixtures/gtfs/testville/artifacts');

export interface StubFeed {
  feedVersionId: number;
  cityCode: string;
  validFrom: string;
  validTo: string;
}

export interface TransitStub {
  readonly url: string;
  /** Active feed per city; delete a city to answer 404. */
  readonly active: Map<string, StubFeed>;
  /** Feed versions whose artifacts answer 500 (to simulate a failing load). */
  readonly broken: Set<number>;
  readonly requests: string[];
  close(): Promise<void>;
}

const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, name), 'utf8')) as Record<string, unknown>;

export async function startTransitStub(): Promise<TransitStub> {
  const app: FastifyInstance = Fastify();
  const active = new Map<string, StubFeed>();
  const broken = new Set<number>();
  const requests: string[] = [];
  app.addHook('onRequest', async (req) => {
    requests.push(req.url);
  });
  app.get('/internal/cities/:code/active-feed', async (req, reply) => {
    const feed = active.get((req.params as { code: string }).code);
    return feed === undefined ? reply.status(404).send({ title: 'Not found', status: 404 }) : feed;
  });
  app.get('/internal/feed-versions/:id/hex-access', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (broken.has(id)) {
      return reply.status(500).send({ title: 'boom', status: 500 });
    }
    return { ...read('hex-access.json'), feedVersionId: id };
  });
  app.get('/internal/feed-versions/:id/timetable', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { date } = req.query as { date: string };
    if (broken.has(id)) {
      return reply.status(500).send({ title: 'boom', status: 500 });
    }
    try {
      return { ...read(`timetable-${date}.json`), feedVersionId: id };
    } catch {
      return reply.status(422).send({ title: 'date outside the feed', status: 422 });
    }
  });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  return { url, active, broken, requests, close: () => app.close() };
}
