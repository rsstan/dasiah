// Accounts (identity.users). SQL on schema identity only.
import { sql, type Kysely } from 'kysely';
import type { IdentityDb } from './schema.ts';

export interface UserRecord {
  readonly userId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly role: 'user' | 'admin';
  readonly locale: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

type Db = Kysely<IdentityDb>;

function selectUsers(db: Db) {
  return db
    .selectFrom('identity.users as u')
    .innerJoin('identity.roles as r', 'r.role_id', 'u.role_id')
    .select([
      'u.user_id as userId',
      sql<string>`u.email::text`.as('email'),
      'u.password_hash as passwordHash',
      'u.display_name as displayName',
      sql<'user' | 'admin'>`r.code`.as('role'),
      'u.locale as locale',
      'u.created_at as createdAt',
      'u.deleted_at as deletedAt',
    ]);
}

/** Case-insensitive (citext); deleted accounts are not returned. */
export async function findActiveUserByEmail(db: Db, email: string): Promise<UserRecord | undefined> {
  return selectUsers(db).where('u.email', '=', email).where('u.deleted_at', 'is', null).executeTakeFirst();
}

export async function findUserById(db: Db, userId: string): Promise<UserRecord | undefined> {
  return selectUsers(db).where('u.user_id', '=', userId).executeTakeFirst();
}

export async function insertUser(
  db: Db,
  user: { email: string; passwordHash: string; displayName: string | null; locale: string | undefined },
): Promise<string> {
  const row = await db
    .insertInto('identity.users')
    .values({
      email: user.email,
      password_hash: user.passwordHash,
      display_name: user.displayName,
      ...(user.locale === undefined ? {} : { locale: user.locale }),
    })
    .returning('user_id')
    .executeTakeFirstOrThrow();
  return row.user_id;
}

/** Returns false when the account does not exist or is deleted. */
export async function updateProfile(
  db: Db,
  userId: string,
  changes: { displayName?: string | null; locale?: string },
): Promise<boolean> {
  const result = await db
    .updateTable('identity.users')
    .set({
      ...(changes.displayName === undefined ? {} : { display_name: changes.displayName }),
      ...(changes.locale === undefined ? {} : { locale: changes.locale }),
    })
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function updatePasswordHash(db: Db, userId: string, passwordHash: string): Promise<void> {
  await db.updateTable('identity.users').set({ password_hash: passwordHash }).where('user_id', '=', userId).execute();
}

/** identity.anonymize_user: scrubs personal data, ends sessions, writes identity.user.deleted.v1 to the outbox. */
export async function anonymizeUser(db: Db, userId: string): Promise<void> {
  await sql`CALL identity.anonymize_user(${userId}::uuid)`.execute(db);
}
