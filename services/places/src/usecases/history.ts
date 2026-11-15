// Search history of the signed-in user (the latest 50 are kept by a trigger), and the event
// handlers that fill and erase it.
import { ValidationError, type EventHandlers, type Logger } from '@heatmap/common';
import type { AppContext } from '../context.ts';

export interface HistoryPage {
  items: { calculationId: string; cityCode: string; originH3: string; createdAt: string }[];
  nextCursor: string | null;
}

const encode = (at: Date, id: number): string => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

function decode(cursor: string): [string, number] {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (at === undefined || id === undefined || Number.isNaN(Date.parse(at)) || !/^\d+$/.test(id)) {
    throw new ValidationError('The cursor is not valid.', {
      errors: [{ path: '/query/cursor', message: 'unknown cursor' }],
    });
  }
  return [at, Number(id)];
}

export async function listHistory(ctx: AppContext, userId: string, limit = 20, cursor?: string): Promise<HistoryPage> {
  const params: unknown[] = [userId, limit + 1];
  let after = '';
  if (cursor !== undefined) {
    const [at, id] = decode(cursor);
    params.push(at, id);
    after = 'AND (created_at, history_id) < ($3::timestamptz, $4::bigint)';
  }
  const { rows } = await ctx.pool.query<{
    history_id: number;
    calculation_id: string;
    city_code: string;
    origin_h3: string;
    created_at: Date;
  }>(
    `SELECT history_id, calculation_id, city_code, origin_h3, created_at FROM places.search_history
      WHERE user_id = $1 ${after} ORDER BY created_at DESC, history_id DESC LIMIT $2`,
    params,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      calculationId: r.calculation_id,
      cityCode: r.city_code,
      originH3: r.origin_h3,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > limit && last !== undefined ? encode(last.created_at, last.history_id) : null,
  };
}

/** Consumers (inbox transaction provided by EventConsumer). */
export function eventHandlers(logger: Logger): EventHandlers {
  return {
    'accessibility.calculation.completed.v1': async (event, tx) => {
      const { userId, calculationId, cityCode, originH3 } = event.data;
      if (userId === null) {
        return; // anonymous request: nothing is kept
      }
      // Asking the same map again moves it to the top.
      await tx.query(
        `INSERT INTO places.search_history (user_id, calculation_id, city_code, origin_h3, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, calculation_id) DO UPDATE SET created_at = EXCLUDED.created_at`,
        [userId, calculationId, cityCode, originH3, event.time],
      );
    },
    'identity.user.deleted.v1': async (event, tx) => {
      const { rows } = await tx.query<{ removed: number }>('SELECT places.erase_user($1) AS removed', [
        event.data.userId,
      ]);
      logger.info({ user_id: event.data.userId, removed: rows[0]?.removed ?? 0 }, 'user data erased');
    },
  };
}
