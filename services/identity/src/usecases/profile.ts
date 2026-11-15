// Profile representation of the API (UserProfile in contracts/openapi/identity.yaml).
import type { UserRecord } from '../repositories/users.ts';

export interface Profile {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: 'user' | 'admin';
  readonly locale: string;
  readonly createdAt: string;
}

export function toProfile(user: UserRecord): Profile {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    locale: user.locale,
    createdAt: user.createdAt.toISOString(),
  };
}
