// Fastify route schemas taken from a dereferenced OpenAPI document (@heatmap/contracts), so
// request validation and response serialisation follow the contract. Response schemas also act
// as an allow-list: a property that is not in the contract is never sent.
import type { FastifySchema } from 'fastify';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function objectSchema(parameters: Json[]): Json | undefined {
  if (parameters.length === 0) {
    return undefined;
  }
  return {
    type: 'object',
    properties: Object.fromEntries(parameters.map((p) => [String(p['name']), p['schema'] ?? {}])),
    required: parameters.filter((p) => p['required'] === true).map((p) => String(p['name'])),
  };
}

/**
 * Schema for `method path` of `document` (dereferenced OpenAPI 3.1): params, querystring, JSON
 * body and every 2xx JSON response. Throws if the operation is not in the contract.
 */
export function routeSchema(document: unknown, method: string, path: string): FastifySchema {
  const paths = isObject(document) && isObject(document['paths']) ? document['paths'] : {};
  const item = paths[path];
  const operation = isObject(item) ? item[method.toLowerCase()] : undefined;
  if (!isObject(item) || !isObject(operation)) {
    throw new Error(`${method.toUpperCase()} ${path} is not in the contract`);
  }
  const parameters = [
    ...(Array.isArray(item['parameters']) ? item['parameters'] : []),
    ...(Array.isArray(operation['parameters']) ? operation['parameters'] : []),
  ].filter(isObject);
  const schema: FastifySchema = {};
  const params = objectSchema(parameters.filter((p) => p['in'] === 'path'));
  const querystring = objectSchema(parameters.filter((p) => p['in'] === 'query'));
  if (params !== undefined) {
    schema.params = params;
  }
  if (querystring !== undefined) {
    schema.querystring = querystring;
  }
  const body = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
  const bodyContent = isObject(body?.['content']) ? body['content'] : undefined;
  const bodyJson = isObject(bodyContent?.['application/json']) ? bodyContent['application/json'] : undefined;
  if (bodyJson !== undefined && isObject(bodyJson['schema'])) {
    schema.body = bodyJson['schema'];
  }
  const responses = isObject(operation['responses']) ? operation['responses'] : {};
  const response: Record<string, unknown> = {};
  for (const [status, value] of Object.entries(responses)) {
    const content = isObject(value) && isObject(value['content']) ? value['content'] : undefined;
    const json = isObject(content?.['application/json']) ? content['application/json'] : undefined;
    if (/^2\d\d$/.test(status) && json !== undefined && isObject(json['schema'])) {
      response[status] = json['schema'];
    }
  }
  if (Object.keys(response).length > 0) {
    schema.response = response;
  }
  return schema;
}
