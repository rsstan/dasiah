// The signed-in user's own account: profile, password, erasure.
import { ForbiddenError, NotFoundError, transaction } from '@heatmap/common';
import type { AppContext, ClientInfo } from '../context.ts';
import { hashPassword, verifyPassword } from '../domain/password.ts';
import { revokeAllRefreshTokens } from '../repositories/refresh-tokens.ts';
import {
  anonymizeUser,
  findUserById,
  updatePasswordHash,
  updateProfile,
  type UserRecord,
} from '../repositories/users.ts';
import { toProfile, type Profile } from './profile.ts';
import { startSession, type IssuedTokens } from './sessions.ts';

async function activeUser(ctx: AppContext, userId: string): Promise<UserRecord> {
  const user = await findUserById(ctx.db, userId);
  if (user === undefined || user.deletedAt !== null) {
    throw new NotFoundError('The account does not exist.');
  }
  return user;
}

export async function getProfile(ctx: AppContext, userId: string): Promise<Profile> {
  return toProfile(await activeUser(ctx, userId));
}

export async function changeProfile(
  ctx: AppContext,
  userId: string,
  changes: { displayName?: string | null; locale?: string },
): Promise<Profile> {
  if (!(await updateProfile(ctx.db, userId, changes))) {
    throw new NotFoundError('The account does not exist.');
  }
  return getProfile(ctx, userId);
}

/** Every session ends; a new one is started for the caller. */
export async function changePassword(
  ctx: AppContext,
  userId: string,
  input: { currentPassword: string; newPassword: string },
  client: ClientInfo,
): Promise<IssuedTokens> {
  const user = await activeUser(ctx, userId);
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ForbiddenError('The current password does not match.', { type: '/problems/wrong-password' });
  }
  const passwordHash = await hashPassword(input.newPassword);
  const tokens = await transaction(ctx.db, async (trx) => {
    await updatePasswordHash(trx, userId, passwordHash);
    const revoked = await revokeAllRefreshTokens(trx, userId);
    ctx.logger.info({ user_id: userId, revoked_sessions: revoked }, 'password changed');
    return startSession(ctx, trx, user, client);
  });
  return tokens;
}

/**
 * Right to erasure: identity.anonymize_user scrubs the personal data, ends every session and
 * writes identity.user.deleted.v1 to the outbox in the same transaction; places then erases
 * the user's places and history.
 */
export async function deleteAccount(ctx: AppContext, userId: string): Promise<void> {
  try {
    await transaction(ctx.db, (trx) => anonymizeUser(trx, userId));
  } catch (error) {
    if ((error as { code?: string }).code === 'P0002') {
      throw new NotFoundError('The account does not exist.');
    }
    throw error;
  }
  ctx.outbox.wake();
  ctx.logger.info({ user_id: userId }, 'account erased');
}
