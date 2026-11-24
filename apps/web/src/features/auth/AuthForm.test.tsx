// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderRoutes } from '../../shared/test/render.tsx';
import { AuthForm } from './AuthForm.tsx';

const USER = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'ann@example.com',
  displayName: 'Ann',
  role: 'user',
  locale: 'en',
  createdAt: '2026-11-15T10:00:00Z',
};
const TOKENS = { accessToken: 'token-1', tokenType: 'Bearer', expiresIn: 900 };

describe('sign-in and registration form', () => {
  it('shows the problems at the fields and sends nothing', async () => {
    const { calls } = mockApi({});
    renderRoutes(<AuthForm onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter an email address like name@example.com.')).toBeTruthy();
    expect(screen.getByText('Password is required.')).toBeTruthy();
    expect(calls).toEqual([]);

    // Fixed while typing, after the first attempt.
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'ann@example.com');
    expect(screen.queryByText('Enter an email address like name@example.com.')).toBeNull();
  });

  it('asks for a longer password when creating an account', async () => {
    mockApi({});
    renderRoutes(<AuthForm onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    await userEvent.type(screen.getByLabelText('Email'), 'ann@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('The password needs at least 10 characters.')).toBeTruthy();
  });

  it('shows a refused sign-in as a form error', async () => {
    mockApi({
      'POST /auth/login': [
        401,
        {
          type: '/problems/invalid-credentials',
          title: 'Unauthorized',
          status: 401,
          detail: 'Email or password is wrong.',
        },
      ],
    });
    const onDone = vi.fn();
    renderRoutes(<AuthForm onDone={onDone} />);
    await userEvent.type(screen.getByLabelText('Email'), 'ann@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is wrong.')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('puts a server validation error at its field', async () => {
    mockApi({
      'POST /auth/register': [
        400,
        { title: 'Bad request', status: 400, errors: [{ path: '/body/email', message: 'must match format "email"' }] },
      ],
    });
    renderRoutes(<AuthForm onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    await userEvent.type(screen.getByLabelText('Email'), 'ann@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('must match format "email"')).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  });

  it('signs in and reports success', async () => {
    const { calls } = mockApi({ 'POST /auth/login': [200, TOKENS], 'GET /users/me': [200, USER] });
    const onDone = vi.fn();
    renderRoutes(<AuthForm onDone={onDone} />);
    await userEvent.type(screen.getByLabelText('Email'), 'ann@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls).toEqual(['POST /auth/login', 'GET /users/me']);
  });
});
