import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { check, email, hasErrors, maxLength, required, serverFieldErrors } from './validation.ts';

describe('validation rules', () => {
  it('reports the first failing rule per field', () => {
    const errors = check({ a: '', b: 'x'.repeat(5) }, { a: [required('A'), email], b: [maxLength(3, 'B')] });
    expect(errors).toEqual({ a: 'A is required.', b: 'B can be at most 3 characters.' });
    expect(hasErrors(errors)).toBe(true);
    expect(hasErrors(check({ a: 'ann@example.com' }, { a: [required('A'), email] }))).toBe(false);
  });

  it('maps the server field errors of a 400 problem onto the fields', () => {
    const problem = new ApiError(
      400,
      { title: 'Bad request', errors: [{ path: '/body/email', message: 'must match format "email"' }] },
      'c',
    );
    expect(serverFieldErrors(problem, { '/body/email': 'email' })).toEqual({ email: 'must match format "email"' });
    expect(serverFieldErrors(new Error('x'), { '/body/email': 'email' })).toEqual({});
  });
});
