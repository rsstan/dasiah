import { describe, expect, it } from 'vitest';
import { validateAuth } from './validation.ts';

describe('sign-in and registration rules', () => {
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
});
