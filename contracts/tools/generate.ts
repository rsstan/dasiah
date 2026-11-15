// pnpm contracts:gen
//
// From the hand-written contracts (contracts/openapi/<service>.yaml, contracts/asyncapi/*.yaml):
//   1. contracts/openapi/gateway.yaml: the public API, composed of every operation whose
//      x-access is public, user or admin, under /api/v1, with security and the gateway's own
//      responses (401, 403, 429, 503). Gateway-only headers (X-User-Id, X-User-Role) removed.
//   2. packages/contracts/src/generated/
//      <api>.ts               TypeScript types (openapi-typescript), also for the gateway
//      <api>.openapi.json     dereferenced document for runtime validation and contract tests
//      routes.json            gateway route table: method, path, service, access, rate limit
//      events.ts              TypeScript types of the event envelopes
//      events.schemas.json    JSON Schema of each event, keyed by event type
//      events.topology.json   exchanges, queues and bindings for RabbitMQ
// The output is deterministic; CI regenerates and fails on a diff.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { compile } from 'json-schema-to-typescript';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';
import { parse, stringify } from 'yaml';

const ROOT = resolve(import.meta.dirname, '../..');
const OPENAPI_DIR = join(ROOT, 'contracts/openapi');
const OUT = join(ROOT, 'packages/contracts/src/generated');
const BIN = join(ROOT, 'node_modules/.bin');

export const SERVICES = ['identity', 'transit-data', 'accessibility', 'places'] as const;
export type ServiceName = (typeof SERVICES)[number];

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;
const GATEWAY_ONLY_PARAMETERS = new Set(['UserId', 'UserIdOptional', 'UserRole']);
type Access = 'public' | 'user' | 'admin' | 'internal';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface RateLimit {
  perMinute: number;
  anonymousPerMinute?: number;
}
export interface Route {
  method: string;
  path: string;
  service: ServiceName;
  operationId: string;
  access: Exclude<Access, 'internal'>;
  rateLimit: RateLimit;
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: Json | undefined, what: string): JsonObject {
  if (!isObject(v)) {
    throw new Error(`${what}: expected an object`);
  }
  return v;
}

function run(bin: string, args: string[]): void {
  try {
    execFileSync(join(BIN, bin), args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    throw new Error(`${bin} ${args.join(' ')} failed\n${stderr}`, { cause: error });
  }
}

function readJson(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(path, 'utf8')) as Json, path);
}

/** TypeScript types of an OpenAPI document (programmatic API, so redocly.yaml is not read). */
async function writeTypes(doc: JsonObject, out: string): Promise<void> {
  const ast = await openapiTS(doc as unknown as Parameters<typeof openapiTS>[0]);
  writeFileSync(out, COMMENT_HEADER + astToString(ast));
}

/** Stable JSON: two-space indent, trailing newline. */
const toJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// ------------------------------------------------------------------ gateway

function refName(ref: Json | undefined): string | undefined {
  return typeof ref === 'string' ? ref.split('/').pop() : undefined;
}

function withoutGatewayOnly(params: Json | undefined): Json[] | undefined {
  if (!Array.isArray(params)) {
    return undefined;
  }
  const kept = params.filter((p) => !(isObject(p) && GATEWAY_ONLY_PARAMETERS.has(refName(p['$ref']) ?? '')));
  return kept.length > 0 ? kept : undefined;
}

function mergeComponents(target: JsonObject, source: JsonObject | undefined, origin: string): void {
  if (source === undefined) {
    return;
  }
  for (const [section, entries] of Object.entries(source)) {
    if (section === 'pathItems') {
      continue; // health path items are internal
    }
    const into = (target[section] ??= {}) as JsonObject;
    for (const [name, value] of Object.entries(obj(entries, `${origin} components.${section}`))) {
      if (name in into && !isDeepStrictEqual(into[name], value)) {
        throw new Error(`components.${section}.${name} differs between services (${origin}); rename one of them`);
      }
      into[name] = value;
    }
  }
}

function buildGateway(
  bundled: Record<ServiceName, JsonObject>,
  common: JsonObject,
): { doc: JsonObject; routes: Route[] } {
  const paths: JsonObject = {};
  const routes: Route[] = [];
  const components: JsonObject = {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from `POST /auth/login` or `POST /auth/refresh`.',
      },
    },
  };
  const commonResponses = obj(obj(common['components'], 'common components')['responses'], 'common responses');
  const operationIds = new Set<string>();

  for (const service of SERVICES) {
    const doc = bundled[service];
    for (const [path, rawItem] of Object.entries(obj(doc['paths'], `${service} paths`))) {
      const item = obj(rawItem, `${service} ${path}`);
      const outItem: JsonObject = {};
      for (const method of METHODS) {
        const op = item[method];
        if (!isObject(op)) {
          continue;
        }
        const access = op['x-access'] as Access | undefined;
        if (access === undefined) {
          throw new Error(`${service} ${method.toUpperCase()} ${path}: missing x-access`);
        }
        if (access === 'internal') {
          continue;
        }
        if (path.startsWith('/internal')) {
          throw new Error(`${service} ${path}: /internal paths must have x-access internal`);
        }
        const rateLimit = op['x-rate-limit'];
        if (!isObject(rateLimit) || typeof rateLimit['perMinute'] !== 'number') {
          throw new Error(`${service} ${method.toUpperCase()} ${path}: public operations need x-rate-limit.perMinute`);
        }
        const operationId = String(op['operationId']);
        if (operationIds.has(operationId)) {
          throw new Error(`operationId ${operationId} is used twice`);
        }
        operationIds.add(operationId);

        const out: JsonObject = { ...op, 'x-service': service };
        const params = withoutGatewayOnly(op['parameters']);
        if (params === undefined) {
          delete out['parameters'];
        } else {
          out['parameters'] = params;
        }
        const anonymousAllowed = access === 'public';
        const optionalUser =
          Array.isArray(op['parameters']) &&
          op['parameters'].some((p) => isObject(p) && refName(p['$ref']) === 'UserIdOptional');
        out['security'] = anonymousAllowed ? (optionalUser ? [{}, { bearerAuth: [] }] : []) : [{ bearerAuth: [] }];

        const responses: JsonObject = { ...obj(op['responses'], `${operationId} responses`) };
        const add = (status: string, name: string): void => {
          responses[status] ??= { $ref: `#/components/responses/${name}` };
        };
        if (!anonymousAllowed || optionalUser) {
          add('401', 'Unauthorized');
        }
        if (access === 'admin') {
          add('403', 'Forbidden');
        }
        add('429', 'TooManyRequests');
        add('503', 'ServiceUnavailable');
        out['responses'] = Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)));
        outItem[method] = out;

        routes.push({
          method: method.toUpperCase(),
          path,
          service,
          operationId,
          access,
          rateLimit: rateLimit as unknown as RateLimit,
        });
      }
      if (Object.keys(outItem).length > 0) {
        const pathParams = withoutGatewayOnly(item['parameters']);
        paths[path] = pathParams === undefined ? outItem : { parameters: pathParams, ...outItem };
      }
    }
    mergeComponents(components, obj(doc['components'], `${service} components`), service);
  }

  // Gateway's own responses and parameters that a service may not have referenced.
  const responses = (components['responses'] ??= {}) as JsonObject;
  for (const name of [
    'Unauthorized',
    'Forbidden',
    'TooManyRequests',
    'ServiceUnavailable',
    'HealthLive',
    'HealthReady',
    'HealthNotReady',
  ]) {
    responses[name] ??= commonResponses[name] ?? null;
  }
  const commonComponents = obj(common['components'], 'common components');
  for (const section of ['schemas', 'headers'] as const) {
    const into = (components[section] ??= {}) as JsonObject;
    for (const [name, value] of Object.entries(obj(commonComponents[section], `common ${section}`))) {
      into[name] ??= value;
    }
  }
  // The bundled common entries still point at #/components/...; parameters used only by services are dropped.
  components['parameters'] = Object.fromEntries(
    Object.entries(obj(components['parameters'] ?? {}, 'parameters')).filter(
      ([name]) => !GATEWAY_ONLY_PARAMETERS.has(name),
    ),
  );

  const health = (operationId: string, ready: boolean): JsonObject => ({
    servers: [{ url: '/' }],
    get: {
      operationId,
      summary: ready ? 'Aggregated readiness of the gateway and every service' : 'Gateway liveness',
      tags: ['health'],
      'x-access': 'public',
      security: [],
      responses: ready
        ? {
            '200': { $ref: '#/components/responses/HealthReady' },
            '503': { $ref: '#/components/responses/HealthNotReady' },
          }
        : { '200': { $ref: '#/components/responses/HealthLive' } },
    },
  });
  paths['/health/live'] = health('gatewayHealthLive', false);
  paths['/health/ready'] = health('gatewayHealthReady', true);

  // Keep only components reachable from the public paths (internal operations bring their own).
  const reachable = new Set<string>();
  const walk = (value: Json): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (isObject(value)) {
      const ref = value['$ref'];
      if (typeof ref === 'string' && ref.startsWith('#/components/') && !reachable.has(ref)) {
        reachable.add(ref);
        const [, , section, name] = ref.split('/');
        walk(obj(components[section ?? ''] ?? null, `components.${section}`)[name ?? ''] ?? null);
      }
      Object.values(value).forEach(walk);
    }
  };
  walk(paths);
  for (const [section, entries] of Object.entries(components)) {
    if (section !== 'securitySchemes') {
      components[section] = Object.fromEntries(
        Object.entries(obj(entries, section)).filter(([name]) => reachable.has(`#/components/${section}/${name}`)),
      );
    }
  }

  const sortedComponents = Object.fromEntries(
    Object.entries(components)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(obj(v, k)).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  const tagService = new Map<string, string>();
  for (const route of routes) {
    const op = obj(obj(paths[route.path] ?? null, route.path)[route.method.toLowerCase()] ?? null, route.operationId);
    for (const tag of Array.isArray(op['tags']) ? op['tags'] : []) {
      tagService.set(String(tag), route.service);
    }
  }
  const tags = [
    ...[...tagService].map(([name, service]) => ({ name, description: `Served by ${service}` })),
    { name: 'health', description: 'Gateway health' },
  ];
  const doc: JsonObject = {
    openapi: '3.1.0',
    info: {
      title: 'Transit Accessibility Heatmap public API',
      version: '1.0.0',
      description: [
        'Public API behind the gateway. GENERATED by `pnpm contracts:gen` from the service contracts in',
        '`contracts/openapi/`; do not edit by hand.',
        '',
        'Every operation keeps `x-access` (public, user, admin), `x-rate-limit` (requests per minute,',
        'per user id when signed in, otherwise per client IP) and `x-service` (upstream). The gateway',
        'sets `X-User-Id` and `X-User-Role` for the upstream after verifying the access token and',
        'strips any such header sent by a client. Every response carries `X-Correlation-Id`.',
      ].join('\n'),
    },
    servers: [{ url: '/api/v1' }],
    tags,
    paths,
    components: sortedComponents as JsonObject,
  };
  return { doc, routes };
}

// ------------------------------------------------------------------ events

interface Topology {
  exchange: { name: string; type: string };
  deadLetterExchange: { name: string; type: string };
  deadLetterQueue: string;
  deliveryLimit: number;
  events: { type: string; publisher: string }[];
  queues: { name: string; consumer: string; routingKey: string }[];
}

/** Rewrites local refs `#/components/schemas/X` to `#/$defs/X` and titles every definition. */
function rewriteRefs(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(rewriteRefs);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === '$ref' && typeof v === 'string' ? v.replace('#/components/schemas/', '#/$defs/') : rewriteRefs(v),
      ]),
    );
  }
  return value;
}

function resolveLocal(value: Json, defs: JsonObject): Json {
  if (Array.isArray(value)) {
    return value.map((v) => resolveLocal(v, defs));
  }
  if (isObject(value)) {
    const ref = value['$ref'];
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
      const name = ref.slice('#/components/schemas/'.length);
      const target = defs[name];
      if (target === undefined) {
        throw new Error(`unknown schema ${ref}`);
      }
      return resolveLocal(target, defs);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveLocal(v, defs)]));
  }
  return value;
}

async function buildEvents(asyncapi: JsonObject): Promise<{ types: string; schemas: JsonObject; topology: Topology }> {
  const components = obj(asyncapi['components'], 'asyncapi components');
  const schemas = obj(components['schemas'], 'asyncapi schemas');
  const messages = obj(components['messages'], 'asyncapi messages');
  const channels = obj(asyncapi['channels'], 'asyncapi channels');
  const operations = obj(asyncapi['operations'], 'asyncapi operations');

  const eventSchemas: JsonObject = {};
  const messageNames: string[] = [];
  for (const [name, raw] of Object.entries(messages)) {
    const message = obj(raw, name);
    const type = String(message['name']);
    const payloadName = refName(obj(message['payload'], `${name} payload`)['$ref']);
    if (payloadName === undefined) {
      throw new Error(`${name}: payload must reference components.schemas`);
    }
    eventSchemas[type] = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...obj(resolveLocal(schemas[payloadName] ?? null, schemas), payloadName),
    };
    messageNames.push(payloadName);
  }

  const defs = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [name, { title: name, ...obj(rewriteRefs(schema), name) }]),
  );
  const root = {
    title: 'HeatmapEvent',
    description: 'Any event published on heatmap.events.',
    oneOf: messageNames.map((n) => ({ $ref: `#/$defs/${n}` })),
    $defs: defs,
  };
  const types = await compile(root as Parameters<typeof compile>[0], 'HeatmapEvent', {
    bannerComment: '/* GENERATED by pnpm contracts:gen from contracts/asyncapi/heatmap-events.yaml. Do not edit. */',
    additionalProperties: false,
    unreachableDefinitions: true,
    format: false,
    strictIndexSignatures: true,
  });

  const firstBinding = obj(
    obj(obj(Object.values(channels)[0] ?? null, 'channel')['bindings'], 'bindings')['amqp'],
    'amqp',
  );
  const bindingName = refName(firstBinding['$ref']);
  const binding = obj(
    obj(components['channelBindings'], 'channelBindings')[bindingName ?? ''] ?? null,
    'channel binding',
  );
  const exchange = obj(binding['exchange'], 'exchange');
  const topology: Topology = {
    exchange: { name: String(exchange['name']), type: String(exchange['type']) },
    deadLetterExchange: { name: 'heatmap.dlx', type: 'fanout' },
    deadLetterQueue: 'heatmap.dlq',
    deliveryLimit: 5,
    events: [],
    queues: [],
  };
  for (const raw of Object.values(operations)) {
    const op = obj(raw, 'operation');
    const channelName = refName(obj(op['channel'], 'operation channel')['$ref']) ?? '';
    const address = String(obj(channels[channelName] ?? null, channelName)['address']);
    if (op['action'] === 'send') {
      topology.events.push({ type: address, publisher: String(op['x-publisher']) });
    } else {
      topology.queues.push({ name: String(op['x-queue']), consumer: String(op['x-consumer']), routingKey: address });
    }
  }
  topology.events.sort((a, b) => a.type.localeCompare(b.type));
  topology.queues.sort((a, b) => a.name.localeCompare(b.name));
  for (const q of topology.queues) {
    if (q.name !== `${q.consumer}.${q.routingKey}`) {
      throw new Error(`queue ${q.name} must be named <consumer>.<event type>`);
    }
  }
  return { types, schemas: eventSchemas, topology };
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'contracts-'));
  try {
    const bundled = {} as Record<ServiceName, JsonObject>;
    for (const service of SERVICES) {
      const bundle = join(work, `${service}.json`);
      run('redocly', ['bundle', service, '-o', bundle]);
      run('redocly', ['bundle', service, '--dereferenced', '-o', join(OUT, `${service}.openapi.json`)]);
      bundled[service] = readJson(bundle);
      await writeTypes(bundled[service], join(OUT, `${service}.ts`));
      // Re-serialise for a stable trailing newline and key order of the dereferenced file.
      writeFileSync(join(OUT, `${service}.openapi.json`), toJson(readJson(join(OUT, `${service}.openapi.json`))));
    }

    const common = obj(parse(readFileSync(join(OPENAPI_DIR, 'common.yaml'), 'utf8')) as Json, 'common.yaml');
    const { doc, routes } = buildGateway(bundled, common);
    const header = '# GENERATED by `pnpm contracts:gen` from the service contracts. Do not edit by hand.\n';
    writeFileSync(
      join(OPENAPI_DIR, 'gateway.yaml'),
      header + stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false }),
    );
    run('redocly', ['bundle', 'gateway', '--dereferenced', '-o', join(OUT, 'gateway.openapi.json')]);
    writeFileSync(join(OUT, 'gateway.openapi.json'), toJson(readJson(join(OUT, 'gateway.openapi.json'))));
    await writeTypes(doc, join(OUT, 'gateway.ts'));
    writeFileSync(join(OUT, 'routes.json'), toJson(routes));

    const asyncapi = obj(
      parse(readFileSync(join(ROOT, 'contracts/asyncapi/heatmap-events.yaml'), 'utf8')) as Json,
      'heatmap-events.yaml',
    );
    const events = await buildEvents(asyncapi);
    writeFileSync(join(OUT, 'events.ts'), events.types);
    writeFileSync(join(OUT, 'events.schemas.json'), toJson(events.schemas));
    writeFileSync(join(OUT, 'events.topology.json'), toJson(events.topology));

    console.log(
      `contracts: ${SERVICES.length} services, ${routes.length} gateway routes, ${events.topology.queues.length} queues`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
