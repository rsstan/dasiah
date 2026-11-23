// Rules of the sign-in and registration form (identity's contract: email, password 10..128,
// name 1..80).
import { check, email, maxLength, minLength, required, type FieldErrors } from '../../shared/lib/validation.ts';

export const MIN_PASSWORD = 10;

export type AuthField = 'email' | 'password' | 'displayName';
export interface AuthValues {
  email: string;
  password: string;
  displayName: string;
}

export function validateAuth(values: AuthValues, mode: 'sign-in' | 'register'): FieldErrors<AuthField> {
  return check<AuthField>(values, {
    email: [required('Email'), email],
    password:
      mode === 'register'
        ? [required('Password'), minLength(MIN_PASSWORD, 'The password'), maxLength(128, 'The password')]
        : [required('Password')],
    displayName: mode === 'register' ? [maxLength(80, 'The name')] : [],
  });
}

/** Where identity reports a field in a 400 problem. */
export const AUTH_SERVER_FIELDS: Record<string, AuthField> = {
  '/body/email': 'email',
  '/body/password': 'password',
  '/body/displayName': 'displayName',
};
