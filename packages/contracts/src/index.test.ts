import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, openApiDocuments, routes, topology, validateEvent } from './index.ts';

const feedActivated = {
  id: '0b6f3c1e-8a52-4d5e-9b1a-2f0c7d9e4a11',
  type: 'transit.feed.activated.v1',
  source: 'transit-data',
  time: '2026-11-15T12:00:00Z',
  correlationId: '6d1f2a7c-3b4e-4c5d-8e9f-0a1b2c3d4e5f',
  // Same keys as jsonb_build_object in transit.activate_feed().
  data: { cityCode: 'waw', feedVersionId: 12, validFrom: '2026-11-01', validTo: '2027-03-31' },
};

type Operation = {
  'x-access'?: string;
  security?: unknown[];
  responses: Record<string, unknown>;
  parameters?: { name: string }[];
};

function gatewayOperation(method: string, path: string): Operation {
  const paths = openApiDocuments.gateway.paths as unknown as Record<string, Record<string, Operation>>;
  const op = paths[path]?.[method.toLowerCase()];
  if (op === undefined) {
    throw new Error(`no ${method} ${path} in gateway.yaml`);
  }
  return op;
}

describe('gateway route table', () => {
  it('has every public operation of the contracts and no internal path', () => {
    expect(routes).toHaveLength(24);
    expect(routes.some((r) => r.path.startsWith('/internal') || r.path.startsWith('/.well-known'))).toBe(false);
    expect(new Set(routes.map((r) => r.operationId)).size).toBe(routes.length);
  });

  it('keeps the access levels and limits of docs/04-contracts.md', () => {
    const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path);
    expect(find('POST', '/auth/register')).toMatchObject({
      service: 'identity',
      access: 'public',
      rateLimit: { perMinute: 5 },
    });
    expect(find('DELETE', '/users/me')).toMatchObject({ access: 'user', rateLimit: { perMinute: 5 } });
    expect(find('POST', '/admin/feed-sources/{code}/import')).toMatchObject({
      access: 'admin',
      rateLimit: { perMinute: 6 },
    });
    expect(find('POST', '/calculations')).toMatchObject({
      service: 'accessibility',
      access: 'public',
      rateLimit: { perMinute: 20, anonymousPerMinute: 6 },
    });
    expect(routes.filter((r) => r.path.startsWith('/admin')).every((r) => r.access === 'admin')).toBe(true);
  });

  it('documents 401/403/429 at the gateway and hides the identity headers', () => {
    for (const route of routes) {
      const op = gatewayOperation(route.method, route.path);
      expect(op.responses['429'], route.operationId).toBeDefined();
      if (route.access !== 'public') {
        expect(op.responses['401'], route.operationId).toBeDefined();
        expect(op.security, route.operationId).toEqual([{ bearerAuth: [] }]);
      }
      if (route.access === 'admin') {
        expect(op.responses['403'], route.operationId).toBeDefined();
      }
      expect(op.parameters?.some((p) => p.name === 'X-User-Id' || p.name === 'X-User-Role') ?? false).toBe(false);
    }
  });
});

describe('events', () => {
  it('declares three events and one queue per consumer and event', () => {
    expect(EVENT_TYPES.sort()).toEqual([
      'accessibility.calculation.completed.v1',
      'identity.user.deleted.v1',
      'transit.feed.activated.v1',
    ]);
    expect(topology.queues.map((q) => q.name)).toEqual([
      'accessibility.transit.feed.activated.v1',
      'places.accessibility.calculation.completed.v1',
      'places.identity.user.deleted.v1',
    ]);
    expect(topology.exchange).toEqual({ name: 'heatmap.events', type: 'topic' });
  });

  it('accepts a valid envelope', () => {
    expect(validateEvent(feedActivated)).toMatchObject({ ok: true });
    expect(
      validateEvent({
        ...feedActivated,
        type: 'accessibility.calculation.completed.v1',
        source: 'accessibility',
        data: {
          calculationId: 'c0000000-0000-4000-8000-000000000001',
          cityCode: 'waw',
          originH3: '8a1f53c9a437fff',
          userId: null,
          cacheHit: false,
        },
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects unknown types, wrong sources, missing and extra fields', () => {
    expect(validateEvent({ ...feedActivated, type: 'transit.feed.exploded.v1' })).toMatchObject({ ok: false });
    expect(validateEvent({ ...feedActivated, source: 'places' })).toMatchObject({ ok: false });
    const { feedVersionId: _, ...withoutId } = feedActivated.data;
    expect(validateEvent({ ...feedActivated, data: withoutId })).toMatchObject({ ok: false });
    expect(validateEvent({ ...feedActivated, data: { ...feedActivated.data, email: 'x@example.com' } })).toMatchObject({
      ok: false,
    });
    expect(validateEvent({ ...feedActivated, time: 'yesterday' })).toMatchObject({ ok: false });
    expect(validateEvent('not an object')).toMatchObject({ ok: false });
  });
});
