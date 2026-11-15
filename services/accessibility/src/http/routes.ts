// HTTP routes of accessibility; schemas come from contracts/openapi/accessibility.yaml.
import { gzipSync } from 'node:zlib';
import { ConflictError, currentContext, routeSchema, type FastifyInstance } from '@heatmap/common';
import { openApiDocuments } from '@heatmap/contracts';
import type { CalculationService } from '../calculation/calculations.ts';
import type { CalculationInput } from '../calculation/request.ts';
import type { AppContext } from '../context.ts';

const contract = (method: string, path: string) => routeSchema(openApiDocuments.accessibility, method, path);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toNumber = (v: string | null): number | null => (v === null ? null : Number(v));

export async function registerRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  calculations: CalculationService,
): Promise<void> {
  app.get('/legend', { schema: contract('get', '/legend') }, async (_req, reply) => {
    const rows = await ctx.db.selectFrom('accessibility.ratio_classes').selectAll().orderBy('sort_order').execute();
    reply.header('cache-control', 'public, max-age=3600');
    return {
      items: rows.map((r) => ({
        code: r.code,
        label: r.label,
        minRatio: toNumber(r.min_ratio),
        maxRatio: toNumber(r.max_ratio),
        color: r.color,
        sortOrder: r.sort_order,
      })),
    };
  });

  app.post('/calculations', { schema: contract('post', '/calculations') }, async (req, reply) => {
    const userId = currentContext()?.userId;
    const outcome = await calculations.request(
      req.body as CalculationInput,
      userId !== undefined && UUID.test(userId) ? userId : undefined,
    );
    const location = `/api/v1/calculations/${outcome.calculation.calculationId}`;
    switch (outcome.kind) {
      case 'cached':
        return reply.status(200).send(outcome.calculation);
      case 'computed':
        return reply.status(201).header('location', location).send(outcome.calculation);
      case 'running':
        return reply.status(202).header('location', location).header('retry-after', '1').send(outcome.calculation);
    }
  });

  app.get('/calculations/:id', { schema: contract('get', '/calculations/{id}') }, async (req) =>
    calculations.get((req.params as { id: string }).id),
  );

  // Sent pre-serialised and gzipped (about 5 000 cells): no response schema on this route; the
  // contract tests validate the body against the OpenAPI document.
  const { response: _resultsResponse, ...resultsSchema } = contract('get', '/calculations/{id}/results');
  app.get('/calculations/:id/results', { schema: resultsSchema }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const calculation = await calculations.get(id);
    if (calculation.status !== 'done') {
      throw new ConflictError(`The calculation is ${calculation.status}.`, { type: '/problems/calculation-not-done' });
    }
    const rows = await ctx.db
      .selectFrom('accessibility.v_calculation_results')
      .select(['h3_index', 'transit_s', 'car_s', 'ratio', 'class_code'])
      .where('calculation_id', '=', id)
      .orderBy('h3_index')
      .execute();
    const snapshot = ctx.timetables.current(calculation.cityCode);
    const body = JSON.stringify({
      calculationId: id,
      resolution: snapshot?.cells.resolution ?? 9,
      cells: rows.map((r) => ({
        h3: r.h3_index,
        transitS: r.transit_s,
        carS: r.car_s,
        ratio: toNumber(r.ratio),
        class: r.class_code,
      })),
    });
    reply
      .type('application/json')
      .header('cache-control', 'public, max-age=86400, immutable')
      .header('vary', 'accept-encoding');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      return reply.header('content-encoding', 'gzip').send(gzipSync(body));
    }
    return reply.send(body);
  });
}
