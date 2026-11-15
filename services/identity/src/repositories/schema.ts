// Kysely types of schema `identity` (services/identity/migrations). Only this service's schema.
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface RolesTable {
  role_id: number;
  code: string;
  name: string;
}

export interface AuditEventTypesTable {
  event_type_id: number;
  code: string;
  description: string;
}

export interface UsersTable {
  user_id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string | null;
  role_id: Generated<number>;
  locale: Generated<string>;
  email_verified_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface RefreshTokensTable {
  token_id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  issued_at: Generated<Date>;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  replaced_by: string | null;
  user_agent: string | null;
  ip: string | null;
}

export interface AuditLogTable {
  audit_id: Generated<number>;
  user_id: string | null;
  event_type_id: number;
  occurred_at: Generated<Date>;
  ip: string | null;
  db_actor: Generated<string>;
}

export interface IdentityDb {
  'identity.roles': RolesTable;
  'identity.audit_event_types': AuditEventTypesTable;
  'identity.users': UsersTable;
  'identity.refresh_tokens': RefreshTokensTable;
  'identity.audit_log': AuditLogTable;
}

export type AuditCode = 'login_succeeded' | 'login_failed' | 'login_locked' | 'refresh_token_reused';
