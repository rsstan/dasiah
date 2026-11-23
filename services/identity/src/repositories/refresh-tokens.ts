// Refresh tokens (identity.refresh_tokens): only the SHA-256 of a token is stored.
import { sql, type Kysely } from 'kysely';
import type { IdentityDb } from './schema.ts';

type Db = Kysely<IdentityDb>;

export interface StoredRefreshToken {
  readonly tokenId: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedBy: string | null;
}

export async function insertRefreshToken(
  db: Db,
  token: { userId: string; hash: Buffer; ttlS: number; userAgent: string | null; ip: string | null },
): Promise<string> {
  const row = await db
    .insertInto('identity.refresh_tokens')
    .values({
      user_id: token.userId,
      token_hash: token.hash,
      expires_at: sql<Date>`now() + make_interval(secs => ${token.ttlS})`,
      user_agent: token.userAgent,
      ip: token.ip,
    })
    .returning('token_id')
    .executeTakeFirstOrThrow();
  return row.token_id;
}

/** Locks the token row for the rest of the transaction (rotation is serialised per token). */
export async function findRefreshTokenForUpdate(db: Db, hash: Buffer): Promise<StoredRefreshToken | undefined> {
  return db
    .selectFrom('identity.refresh_tokens')
    .select([
      'token_id as tokenId',
      'user_id as userId',
      'expires_at as expiresAt',
      'revoked_at as revokedAt',
      'replaced_by as replacedBy',
    ])
    .where('token_hash', '=', hash)
    .forUpdate()
    .executeTakeFirst();
}

/** The same as findRefreshTokenForUpdate, by id (the successor of a rotated token). */
export async function findRefreshTokenByIdForUpdate(db: Db, tokenId: string): Promise<StoredRefreshToken | undefined> {
  return db
    .selectFrom('identity.refresh_tokens')
    .select([
      'token_id as tokenId',
      'user_id as userId',
      'expires_at as expiresAt',
      'revoked_at as revokedAt',
      'replaced_by as replacedBy',
    ])
    .where('token_id', '=', tokenId)
    .forUpdate()
    .executeTakeFirst();
}

export async function markReplaced(db: Db, tokenId: string, replacedBy: string): Promise<void> {
  await db
    .updateTable('identity.refresh_tokens')
    .set({ revoked_at: sql<Date>`now()`, replaced_by: replacedBy })
    .where('token_id', '=', tokenId)
    .execute();
}

/** Revokes one live token of a user (logout). */
export async function revokeRefreshToken(db: Db, userId: string, hash: Buffer): Promise<void> {
  await db
    .updateTable('identity.refresh_tokens')
    .set({ revoked_at: sql<Date>`now()` })
    .where('token_hash', '=', hash)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
}

/** Revokes every live token of a user; returns how many. */
export async function revokeAllRefreshTokens(db: Db, userId: string): Promise<number> {
  const result = await db
    .updateTable('identity.refresh_tokens')
    .set({ revoked_at: sql<Date>`now()` })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
