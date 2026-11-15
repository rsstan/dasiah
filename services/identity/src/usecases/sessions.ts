// Starting a session: a new refresh token (stored hashed) plus an access token.
import type { Kysely } from 'kysely';
import type { AppContext, ClientInfo } from '../context.ts';
import { newRefreshToken } from '../domain/tokens.ts';
import { insertRefreshToken } from '../repositories/refresh-tokens.ts';
import type { IdentityDb } from '../repositories/schema.ts';
import type { UserRecord } from '../repositories/users.ts';

export interface IssuedTokens {
  readonly accessToken: string;
  readonly expiresIn: number;
  /** Goes only into the HttpOnly cookie, never into a response body or a log. */
  readonly refreshToken: string;
  readonly refreshTokenId: string;
}

export async function startSession(
  ctx: AppContext,
  db: Kysely<IdentityDb>,
  user: Pick<UserRecord, 'userId' | 'role'>,
  client: ClientInfo,
): Promise<IssuedTokens> {
  const { token, hash } = newRefreshToken();
  const refreshTokenId = await insertRefreshToken(db, {
    userId: user.userId,
    hash,
    ttlS: ctx.config.REFRESH_TTL_S,
    userAgent: client.userAgent,
    ip: client.ip,
  });
  const accessToken = await ctx.tokens.issueAccessToken({ userId: user.userId, role: user.role });
  return { accessToken, expiresIn: ctx.tokens.accessTtlS, refreshToken: token, refreshTokenId };
}
