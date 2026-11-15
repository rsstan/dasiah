// HTTP routes of places; schemas come from contracts/openapi/places.yaml.
import { currentContext, routeSchema, UnauthorizedError, type FastifyInstance } from '@heatmap/common';
import { openApiDocuments } from '@heatmap/contracts';
import type { AppContext } from '../context.ts';
import { geocode } from '../usecases/geocode.ts';
import { listHistory } from '../usecases/history.ts';
import { createPlace, deletePlace, listPlaces, updatePlace, type PlaceInput } from '../usecases/saved-places.ts';

const contract = (method: string, path: string) => routeSchema(openApiDocuments.places, method, path);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in user, from X-User-Id set by the gateway. */
function caller(): string {
  const userId = currentContext()?.userId;
  if (userId === undefined || !UUID.test(userId)) {
    throw new UnauthorizedError('Sign in first.');
  }
  return userId;
}

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/geocode', { schema: contract('get', '/geocode') }, async (req) => {
    const { city, q } = req.query as { city: string; q: string };
    return geocode(ctx, city, q);
  });

  app.get('/places', { schema: contract('get', '/places') }, async () => listPlaces(ctx, caller()));

  app.post('/places', { schema: contract('post', '/places') }, async (req, reply) => {
    const place = await createPlace(ctx, caller(), req.body as Required<PlaceInput>);
    return reply.status(201).header('location', `/api/v1/places/${place.placeId}`).send(place);
  });

  app.patch('/places/:id', { schema: contract('patch', '/places/{id}') }, async (req) =>
    updatePlace(ctx, caller(), (req.params as { id: string }).id, req.body as PlaceInput),
  );

  app.delete('/places/:id', { schema: contract('delete', '/places/{id}') }, async (req, reply) => {
    await deletePlace(ctx, caller(), (req.params as { id: string }).id);
    return reply.status(204).send();
  });

  app.get('/history', { schema: contract('get', '/history') }, async (req) => {
    const { limit, cursor } = req.query as { limit?: number; cursor?: string };
    return listHistory(ctx, caller(), limit, cursor);
  });
}
