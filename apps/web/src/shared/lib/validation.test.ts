import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { validateSourceCode } from '../../features/admin/validation.ts';
import { validateAuth } from '../../features/auth/validation.ts';
import { labelConflict, validateLabel } from '../../features/places/validation.ts';
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

describe('form rules', () => {
  it('sign-in and registration', () => {
    expect(validateAuth({ email: '', password: '', displayName: '' }, 'sign-in')).toEqual({
      email: 'Email is required.',
      password: 'Password is required.',
    });
    expect(validateAuth({ email: 'ann@', password: 'short', displayName: 'x'.repeat(81) }, 'register')).toEqual({
      email: 'Enter an email address like name@example.com.',
      password: 'The password needs at least 10 characters.',
      displayName: 'The name can be at most 80 characters.',
    });
    expect(validateAuth({ email: 'ann@example.com', password: 'short', displayName: '' }, 'sign-in')).toEqual({});
  });

  it('place names and the duplicate-name conflict', () => {
    expect(validateLabel('', 'save')).toBeUndefined();
    expect(validateLabel('  ', 'rename')).toBe('A name is required.');
    expect(validateLabel('x'.repeat(61), 'save')).toBe('The name can be at most 60 characters.');
    expect(labelConflict(new ApiError(409, { type: '/problems/duplicate-label' }, 'c'))).toMatch(/already have/);
    expect(labelConflict(new ApiError(409, { type: '/problems/place-limit' }, 'c'))).toBeUndefined();
  });

  it('feed source codes', () => {
    expect(validateSourceCode('')).toBe('A feed source is required.');
    expect(validateSourceCode('Vno-VVT')).toMatch(/lowercase/);
    expect(validateSourceCode('vno_vvt')).toBeUndefined();
  });
});
