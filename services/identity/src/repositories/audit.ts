// Security audit trail (identity.audit_log, append-only for this service's role). Account changes
// are recorded by the users_audit trigger; sign-in events are recorded here.
import { sql, type Kysely } from 'kysely';
import type { AuditCode, IdentityDb } from './schema.ts';

type Db = Kysely<IdentityDb>;

export async function recordAudit(
  db: Db,
  event: { code: AuditCode; userId: string | null; ip: string | null },
): Promise<void> {
  await db
    .insertInto('identity.audit_log')
    .columns(['user_id', 'event_type_id', 'ip'])
    .expression((eb) =>
      eb
        .selectFrom('identity.audit_event_types')
        .select([
          sql<string | null>`${event.userId}::uuid`.as('user_id'),
          'event_type_id',
          sql<string | null>`${event.ip}::inet`.as('ip'),
        ])
        .where('code', '=', event.code),
    )
    .execute();
}

/**
 * Failed sign-ins of a user within the last `windowS` seconds that happened after the user's
 * last successful sign-in, and the time of the oldest of them.
 */
export async function recentFailures(
  db: Db,
  userId: string,
  windowS: number,
): Promise<{ count: number; oldest: Date | null }> {
  const row = await db
    .selectFrom('identity.audit_log as a')
    .innerJoin('identity.audit_event_types as t', 't.event_type_id', 'a.event_type_id')
    .select([sql<number>`count(*)`.as('count'), sql<Date | null>`min(a.occurred_at)`.as('oldest')])
    .where('a.user_id', '=', userId)
    .where('t.code', '=', 'login_failed')
    .where('a.occurred_at', '>', sql<Date>`now() - make_interval(secs => ${windowS})`)
    .where(
      'a.occurred_at',
      '>',
      sql<Date>`coalesce((SELECT max(s.occurred_at) FROM identity.audit_log s
                           JOIN identity.audit_event_types st ON st.event_type_id = s.event_type_id
                          WHERE s.user_id = ${userId}::uuid AND st.code = 'login_succeeded'), '-infinity')`,
    )
    .executeTakeFirstOrThrow();
  return { count: Number(row.count), oldest: row.oldest };
}
