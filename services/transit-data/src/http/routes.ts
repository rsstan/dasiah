// HTTP routes of transit-data; schemas come from contracts/openapi/transit-data.yaml.
import { gunzipSync } from 'node:zlib';
import {
  currentContext,
  ForbiddenError,
  NotFoundError,
  routeSchema,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from '@heatmap/common';
import { openApiDocuments } from '@heatmap/contracts';
import type { AppContext } from '../context.ts';
import type { Importer } from '../import/importer.ts';
import { findCity, findCoverage, listEnabledCities, type CityRow } from '../repositories/cities.ts';
import type { ArtifactStore, Artifact } from '../timetable/artifacts.ts';
import { activateFeedVersion, getFeedVersion, listFeedVersions } from '../usecases/feeds.ts';

const contract = (method: string, path: string) => routeSchema(openApiDocuments['transit-data'], method, path);

/** Request schema only: artifacts are sent pre-serialised and gzipped. */
function requestOnly(method: string, path: string) {
  const { response: _response, ...schema } = contract(method, path);
  return schema;
}

function activeFeed(city: CityRow) {
  return city.feedVersionId === null || city.validFrom === null || city.validTo === null
    ? null
    : { feedVersionId: city.feedVersionId, cityCode: city.code, validFrom: city.validFrom, validTo: city.validTo };
}

function toCity(city: CityRow) {
  return {
    code: city.code,
    name: city.name,
    countryCode: city.countryCode,
    timezone: city.timezone,
    h3Resolution: city.h3Resolution,
    bounds: { west: city.west, south: city.south, east: city.east, north: city.north },
    activeFeed: activeFeed(city),
  };
}

/** Admin routes are guarded by the gateway too; this check keeps a direct call from working. */
function requireAdmin(): void {
  if (currentContext()?.userRole !== 'admin') {
    throw new ForbiddenError('Administrators only.', { type: '/problems/admin-only' });
  }
}

function sendArtifact(req: FastifyRequest, reply: FastifyReply, artifact: Artifact) {
  reply
    .header('etag', artifact.etag)
    .header('cache-control', 'private, max-age=3600')
    .header('vary', 'accept-encoding');
  if (req.headers['if-none-match'] === artifact.etag) {
    return reply.status(304).send();
  }
  reply.type('application/json');
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    return reply.header('content-encoding', 'gzip').send(artifact.body);
  }
  return reply.send(gunzipSync(artifact.body));
}

export async function registerRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  { importer, artifacts }: { importer: Importer; artifacts: ArtifactStore },
): Promise<void> {
  app.get('/cities', { schema: contract('get', '/cities') }, async () => ({
    items: (await listEnabledCities(ctx.db)).map(toCity),
  }));

  app.get('/cities/:code/coverage', { schema: contract('get', '/cities/{code}/coverage') }, async (req) => {
    const { code } = req.params as { code: string };
    if ((await findCity(ctx.db, code)) === undefined) {
      throw new NotFoundError(`Unknown city ${code}.`);
    }
    const coverage = await findCoverage(ctx.db, code);
    if (coverage === undefined) {
      throw new NotFoundError(`City ${code} has no active timetable yet.`, { type: '/problems/no-active-feed' });
    }
    return coverage;
  });

  app.get('/admin/feed-versions', { schema: contract('get', '/admin/feed-versions') }, async (req) => {
    requireAdmin();
    return listFeedVersions(ctx, req.query as { source?: string; status?: string; limit?: number; cursor?: string });
  });

  app.get('/admin/feed-versions/:id', { schema: contract('get', '/admin/feed-versions/{id}') }, async (req) => {
    requireAdmin();
    return getFeedVersion(ctx, (req.params as { id: number }).id);
  });

  app.post(
    '/admin/feed-sources/:code/import',
    { schema: contract('post', '/admin/feed-sources/{code}/import') },
    async (req, reply) => {
      requireAdmin();
      const { code } = req.params as { code: string };
      const started = await importer.importFromUrl(code);
      const body = { feedVersionId: started.feedVersionId, status: started.status, duplicate: started.duplicate };
      return reply.status(202).header('location', `/api/v1/admin/feed-versions/${started.feedVersionId}`).send(body);
    },
  );

  app.post(
    '/admin/feed-versions/:id/activate',
    { schema: contract('post', '/admin/feed-versions/{id}/activate') },
    async (req) => {
      requireAdmin();
      return activateFeedVersion(ctx, (req.params as { id: number }).id);
    },
  );

  app.get(
    '/internal/cities/:code/active-feed',
    { schema: contract('get', '/internal/cities/{code}/active-feed') },
    async (req) => {
      const { code } = req.params as { code: string };
      const city = await findCity(ctx.db, code);
      const feed = city === undefined ? null : activeFeed(city);
      if (feed === null) {
        throw new NotFoundError(`City ${code} has no active timetable.`, { type: '/problems/no-active-feed' });
      }
      return feed;
    },
  );

  app.get(
    '/internal/feed-versions/:id/timetable',
    { schema: requestOnly('get', '/internal/feed-versions/{id}/timetable') },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { date } = req.query as { date: string };
      return sendArtifact(req, reply, await artifacts.timetable(id, date));
    },
  );

  app.get(
    '/internal/feed-versions/:id/hex-access',
    { schema: requestOnly('get', '/internal/feed-versions/{id}/hex-access') },
    async (req, reply) => sendArtifact(req, reply, await artifacts.hexAccess((req.params as { id: number }).id)),
  );
}
