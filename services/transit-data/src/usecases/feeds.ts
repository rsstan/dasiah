// Feed versions for the admin API: list, one version, activation.
import { ConflictError, NotFoundError, ValidationError, withTransaction } from '@heatmap/common';
import { sql, type Kysely } from 'kysely';
import type { AppContext } from '../context.ts';
import type { TransitDb } from '../repositories/schema.ts';

export interface FeedVersionView {
  feedVersionId: number;
  sourceCode: string;
  cityCode: string;
  status: string;
  sha256: string;
  fetchedAt: string;
  validFrom: string | null;
  validTo: string | null;
  activatedAt: string | null;
  archivedAt: string | null;
  errorMessage: string | null;
}

function selectVersions(db: Kysely<TransitDb>) {
  return db
    .selectFrom('transit.feed_versions as v')
    .innerJoin('transit.feed_sources as s', 's.feed_source_id', 'v.feed_source_id')
    .innerJoin('transit.cities as c', 'c.city_id', 's.city_id')
    .select([
      'v.feed_version_id as feedVersionId',
      's.code as sourceCode',
      'c.code as cityCode',
      'v.status',
      sql<string>`encode(v.sha256, 'hex')`.as('sha256'),
      'v.fetched_at as fetchedAt',
      'v.valid_from as validFrom',
      'v.valid_to as validTo',
      'v.activated_at as activatedAt',
      'v.archived_at as archivedAt',
      'v.error_message as errorMessage',
    ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof selectVersions>['executeTakeFirstOrThrow']>>;

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

function toView(row: Row): FeedVersionView {
  return {
    ...row,
    fetchedAt: row.fetchedAt.toISOString(),
    activatedAt: iso(row.activatedAt),
    archivedAt: iso(row.archivedAt),
  };
}

const encodeCursor = (id: number): string => Buffer.from(`fv:${id}`).toString('base64url');

function decodeCursor(cursor: string): number {
  const match = /^fv:(\d+)$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (match?.[1] === undefined) {
    throw new ValidationError('The cursor is not valid.', {
      errors: [{ path: '/query/cursor', message: 'unknown cursor' }],
    });
  }
  return Number(match[1]);
}

export async function listFeedVersions(
  ctx: AppContext,
  query: { source?: string; status?: string; limit?: number; cursor?: string },
): Promise<{ items: FeedVersionView[]; nextCursor: string | null }> {
  const limit = query.limit ?? 20;
  let q = selectVersions(ctx.db)
    .orderBy('v.feed_version_id', 'desc')
    .limit(limit + 1);
  if (query.source !== undefined) {
    q = q.where('s.code', '=', query.source);
  }
  if (query.status !== undefined) {
    q = q.where('v.status', '=', query.status);
  }
  if (query.cursor !== undefined) {
    q = q.where('v.feed_version_id', '<', decodeCursor(query.cursor));
  }
  const rows = await q.execute();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toView),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.feedVersionId) : null,
  };
}

export async function getFeedVersion(ctx: AppContext, id: number): Promise<FeedVersionView> {
  const row = await selectVersions(ctx.db).where('v.feed_version_id', '=', id).executeTakeFirst();
  if (row === undefined) {
    throw new NotFoundError(`Feed version ${id} does not exist.`);
  }
  return toView(row);
}

/**
 * Makes a validated version the active one of its source. transit.activate_feed archives the
 * previous version, activates this one, writes transit.feed.activated.v1 to the outbox and
 * refreshes the coverage view, in one transaction.
 */
export async function activateFeedVersion(ctx: AppContext, id: number): Promise<FeedVersionView> {
  await withTransaction(ctx.pool, async (client) => {
    await client.query(`SELECT set_config('statement_timeout', '120000', true)`);
    const { rows } = await client.query<{ status: string; has_access: boolean }>(
      `SELECT status, EXISTS (SELECT 1 FROM transit.hex_stop_access a WHERE a.feed_version_id = v.feed_version_id) AS has_access
         FROM transit.feed_versions v WHERE feed_version_id = $1 FOR UPDATE`,
      [id],
    );
    const version = rows[0];
    if (version === undefined) {
      throw new NotFoundError(`Feed version ${id} does not exist.`);
    }
    if (version.status !== 'validated') {
      throw new ConflictError(`Feed version ${id} is ${version.status}; only a validated version can be activated.`, {
        type: '/problems/feed-not-validated',
      });
    }
    if (!version.has_access) {
      throw new ConflictError(`Feed version ${id} has no stop within walking distance of any cell of the city grid.`, {
        type: '/problems/feed-without-grid',
      });
    }
    await client.query('CALL transit.activate_feed($1)', [id]);
  });
  ctx.outbox.wake();
  ctx.logger.info({ feed_version_id: id }, 'feed version activated');
  return getFeedVersion(ctx, id);
}
