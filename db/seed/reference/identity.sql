-- Reference data for identity. Idempotent; run as app_admin after migrations.
INSERT INTO identity.roles (role_id, code, name) VALUES
  (1, 'user',  'Registered user'),
  (2, 'admin', 'Administrator')
ON CONFLICT (role_id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

INSERT INTO identity.audit_event_types (event_type_id, code, description) VALUES
  (1, 'user_registered',  'Account created'),
  (2, 'login_succeeded',  'Successful sign-in'),
  (3, 'login_failed',     'Failed sign-in attempt'),
  (4, 'password_changed', 'Password hash replaced'),
  (5, 'profile_updated',  'Email, name or locale changed'),
  (6, 'role_changed',     'Role assigned by an administrator'),
  (7, 'user_anonymized',  'Personal data erased')
ON CONFLICT (event_type_id) DO UPDATE SET code = EXCLUDED.code, description = EXCLUDED.description;
