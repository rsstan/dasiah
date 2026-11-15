export * from './config.ts';
export * from './context.ts';
export * from './contract-schema.ts';
export * from './db.ts';
export * from './errors.ts';
export * from './http-client.ts';
export * from './logger.ts';
export * from './server.ts';
export { injectTraceHeaders, startTracing, stopTracing, withExtractedContext, withSpan } from './tracing.ts';
export * from './messaging/broker.ts';
export * from './messaging/consumer.ts';
export * from './messaging/outbox-publisher.ts';
// Types services need from the platform's own dependencies (pnpm keeps dependencies strict).
export type { Kysely, Transaction } from 'kysely';
export type { Pool, PoolClient } from 'pg';
export type { FastifyInstance, FastifyReply, FastifyRequest, LightMyRequestResponse } from 'fastify';
export { z } from 'zod';
export * from './geo.ts';
