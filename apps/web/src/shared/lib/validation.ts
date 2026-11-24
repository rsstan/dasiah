// Field validation for the forms: small rules that return a message or nothing, checked before a
// form is sent; and the server's own field errors (400 with errors[].path) mapped onto the fields.
import { ApiError } from '../api/client.ts';

export type Rule = (value: string) => string | undefined;
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const required =
  (label: string): Rule =>
  (v) =>
    v.trim() === '' ? `${label} is required.` : undefined;

export const email: Rule = (v) =>
  v.trim() === '' || EMAIL.test(v.trim()) ? undefined : 'Enter an email address like name@example.com.';

export const minLength =
  (n: number, label: string): Rule =>
  (v) =>
    v.length > 0 && v.length < n ? `${label} needs at least ${n} characters.` : undefined;

export const maxLength =
  (n: number, label: string): Rule =>
  (v) =>
    v.trim().length > n ? `${label} can be at most ${n} characters.` : undefined;

export const pattern =
  (re: RegExp, message: string): Rule =>
  (v) =>
    v.trim() === '' || re.test(v.trim()) ? undefined : message;

/** The first failing rule's message per field. */
export function check<F extends string>(
  values: Record<F, string>,
  rules: Partial<Record<F, readonly Rule[]>>,
): FieldErrors<F> {
  const errors: FieldErrors<F> = {};
  for (const field of Object.keys(rules) as F[]) {
    for (const rule of rules[field] ?? []) {
      const message = rule(values[field]);
      if (message !== undefined) {
        errors[field] = message;
        break;
      }
    }
  }
  return errors;
}

export function hasErrors(errors: FieldErrors<string>): boolean {
  return Object.values(errors).some((m) => m !== undefined);
}

/** Server field errors (paths like /body/email) on the form's fields. */
export function serverFieldErrors<F extends string>(error: unknown, fields: Record<string, F>): FieldErrors<F> {
  const errors: FieldErrors<F> = {};
  if (error instanceof ApiError) {
    for (const e of error.fieldErrors) {
      const field = fields[e.path];
      if (field !== undefined && errors[field] === undefined) {
        errors[field] = e.message;
      }
    }
  }
  return errors;
}
