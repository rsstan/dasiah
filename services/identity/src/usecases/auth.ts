// Registration, sign-in, refresh-token rotation, sign-out.
import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { ConflictError, TooManyRequestsError, transaction, UnauthorizedError, ValidationError } from '@heatmap/common';
import type { AppContext, ClientInfo } from '../context.ts';
import { hashPassword, verifyPassword } from '../domain/password.ts';
import { hashRefreshToken } from '../domain/tokens.ts';
import { recentFailures, recordAudit } from '../repositories/audit.ts';
import {
  findRefreshTokenByIdForUpdate,
  findRefreshTokenForUpdate,
  markReplaced,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  type StoredRefreshToken,
} from '../repositories/refresh-tokens.ts';
import type { IdentityDb } from '../repositories/schema.ts';
import { findActiveUserByEmail, findUserById, insertUser } from '../repositories/users.ts';
import { toProfile, type Profile } from './profile.ts';
import { startSession, type IssuedTokens } from './sessions.ts';

const INVALID_CREDENTIALS = { type: '/problems/invalid-credentials' };
const INVALID_REFRESH = { type: '/problems/invalid-refresh-token' };

interface PgError {
  code?: string;
  constraint?: string;
}

/** A hash to verify against when the email is unknown, so the response time does not reveal it. */
let dummyHash: Promise<string> | undefined;
const dummy = (): Promise<string> => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

export async function register(
  ctx: AppContext,
  input: { email: string; password: string; displayName?: string; locale?: string },
): Promise<Profile> {
  const passwordHash = await hashPassword(input.password);
  let userId: string;
  try {
    userId = await insertUser(ctx.db, {
      email: input.email,
      passwordHash,
      displayName: input.displayName ?? null,
      locale: input.locale,
    });
  } catch (error) {
    const pgError = error as PgError;
    if (pgError.code === '23505' && pgError.constraint === 'users_email_uq') {
      throw new ConflictError('An account with this email already exists.', { type: '/problems/email-taken' });
    }
    if (pgError.code === '23514') {
      throw new ValidationError('The account data is not acceptable.');
    }
    throw error;
  }
  const user = await findUserById(ctx.db, userId);
  if (user === undefined) {
    throw new Error('registered user not found');
  }
  ctx.logger.info({ user_id: userId }, 'user registered');
  return toProfile(user);
}

export async function login(
  ctx: AppContext,
  input: { email: string; password: string },
  client: ClientInfo,
): Promise<IssuedTokens> {
  const { LOGIN_MAX_FAILURES, LOGIN_LOCK_WINDOW_S } = ctx.config;
  const user = await findActiveUserByEmail(ctx.db, input.email);
  if (user === undefined) {
    await verifyPassword(input.password, await dummy());
    await recordAudit(ctx.db, { code: 'login_failed', userId: null, ip: client.ip });
    throw new UnauthorizedError('Email or password is wrong.', INVALID_CREDENTIALS);
  }

  // Checked before the password, so a locked account cannot be probed.
  const failures = await recentFailures(ctx.db, user.userId, LOGIN_LOCK_WINDOW_S);
  if (failures.count >= LOGIN_MAX_FAILURES) {
    await recordAudit(ctx.db, { code: 'login_locked', userId: user.userId, ip: client.ip });
    const oldest = failures.oldest?.getTime() ?? Date.now();
    const retryAfterS = Math.max(1, Math.ceil(LOGIN_LOCK_WINDOW_S - (Date.now() - oldest) / 1000));
    ctx.logger.warn({ user_id: user.userId, failures: failures.count }, 'sign-in refused: account temporarily locked');
    throw new TooManyRequestsError('Too many failed sign-in attempts. Try again later.', retryAfterS, {
      type: '/problems/account-locked',
    });
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    await recordAudit(ctx.db, { code: 'login_failed', userId: user.userId, ip: client.ip });
    throw new UnauthorizedError('Email or password is wrong.', INVALID_CREDENTIALS);
  }

  const tokens = await transaction(ctx.db, async (trx) => {
    await recordAudit(trx, { code: 'login_succeeded', userId: user.userId, ip: client.ip });
    return startSession(ctx, trx, user, client);
  });
  ctx.logger.info({ user_id: user.userId }, 'signed in');
  return tokens;
}

type RefreshOutcome =
  | { kind: 'rotated'; tokens: IssuedTokens }
  | { kind: 'grace'; tokens: IssuedTokens; userId: string }
  | { kind: 'unknown' | 'revoked' | 'expired' | 'account-gone' }
  | { kind: 'reused'; userId: string; revoked: number };

/**
 * Rotation: the presented token is revoked and replaced. A token that was already replaced
 * is a stolen copy or a replay: every session of the user ends. One exception (grace): within
 * REFRESH_REUSE_GRACE_S of the rotation, while its successor has never been used, the client
 * evidently did not receive the successor (page reloaded or response lost during the refresh):
 * the successor is revoked and a new pair is issued, once.
 */
export async function refresh(ctx: AppContext, token: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
  if (token === undefined || token === '') {
    throw new UnauthorizedError('No refresh token.', INVALID_REFRESH);
  }
  const outcome = await transaction(ctx.db, async (trx): Promise<RefreshOutcome> => {
    const stored = await findRefreshTokenForUpdate(trx, hashRefreshToken(token));
    if (stored === undefined) {
      return { kind: 'unknown' };
    }
    if (stored.revokedAt !== null) {
      if (stored.replacedBy === null) {
        return { kind: 'revoked' };
      }
      const graceTokens = await withinGrace(ctx, trx, stored, client);
      if (graceTokens !== undefined) {
        return { kind: 'grace', tokens: graceTokens, userId: stored.userId };
      }
      const revoked = await revokeAllRefreshTokens(trx, stored.userId);
      await recordAudit(trx, { code: 'refresh_token_reused', userId: stored.userId, ip: client.ip });
      return { kind: 'reused', userId: stored.userId, revoked };
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      return { kind: 'expired' };
    }
    const user = await findUserById(trx, stored.userId);
    if (user === undefined || user.deletedAt !== null) {
      return { kind: 'account-gone' };
    }
    const tokens = await startSession(ctx, trx, user, client);
    await markReplaced(trx, stored.tokenId, tokens.refreshTokenId);
    return { kind: 'rotated', tokens };
  });

  if (outcome.kind === 'rotated') {
    return outcome.tokens;
  }
  if (outcome.kind === 'grace') {
    ctx.logger.info({ user_id: outcome.userId }, 'refresh token presented again within the grace period');
    return outcome.tokens;
  }
  if (outcome.kind === 'reused') {
    ctx.logger.warn(
      { user_id: outcome.userId, revoked_sessions: outcome.revoked },
      'refresh token reuse detected: every session of the user revoked',
    );
  } else {
    ctx.logger.info({ reason: outcome.kind }, 'refresh refused');
  }
  throw new UnauthorizedError(
    outcome.kind === 'expired'
      ? 'The session has expired. Sign in again.'
      : 'The session is no longer valid. Sign in again.',
    INVALID_REFRESH,
  );
}

/** New pair for a just-rotated token whose successor was never used; undefined otherwise. */
async function withinGrace(
  ctx: AppContext,
  trx: Kysely<IdentityDb>,
  stored: StoredRefreshToken,
  client: ClientInfo,
): Promise<IssuedTokens | undefined> {
  const graceMs = ctx.config.REFRESH_REUSE_GRACE_S * 1000;
  if (graceMs === 0 || stored.replacedBy === null || stored.revokedAt === null) {
    return undefined;
  }
  if (Date.now() - stored.revokedAt.getTime() > graceMs) {
    return undefined;
  }
  const successor = await findRefreshTokenByIdForUpdate(trx, stored.replacedBy);
  if (successor === undefined || successor.revokedAt !== null || successor.expiresAt.getTime() <= Date.now()) {
    return undefined; // the successor was used (or ended): a genuine replay
  }
  const user = await findUserById(trx, stored.userId);
  if (user === undefined || user.deletedAt !== null) {
    return undefined;
  }
  const tokens = await startSession(ctx, trx, user, client);
  await markReplaced(trx, successor.tokenId, tokens.refreshTokenId);
  await recordAudit(trx, { code: 'refresh_token_grace', userId: stored.userId, ip: client.ip });
  return tokens;
}

export async function logout(ctx: AppContext, userId: string, token: string | undefined): Promise<void> {
  if (token !== undefined && token !== '') {
    await revokeRefreshToken(ctx.db, userId, hashRefreshToken(token));
  }
  ctx.logger.info({ user_id: userId }, 'signed out');
}
