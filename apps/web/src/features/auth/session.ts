// The signed-in user in this tab. The access token lives only in memory; the refresh token is an
// httpOnly cookie (path /api/v1/auth) the page never sees. Refreshing rotates the cookie and
// identity treats a reused refresh token as theft (every session revoked), so refreshes never
// overlap: one at a time in a tab (single flight) and across tabs (Web Locks), the next one then
// sends the cookie the previous one set.
import { ApiError, request, setAuthHooks } from '../../shared/api/client.ts';
import type { GatewayApi } from '@heatmap/contracts';
import { createStore } from 'zustand/vanilla';

type Schemas = GatewayApi.components['schemas'];
export type UserProfile = Schemas['UserProfile'];
type TokenResponse = Schemas['TokenResponse'];

export type SessionState =
  | { kind: 'unknown' } // restoring from the cookie
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: UserProfile };

/** Refresh this long before the access token expires. */
const EARLY_S = 60;
const LOCK = 'heatmap-refresh';

export class Session {
  /** Global client state (Zustand): who is signed in; components read it through useSession. */
  readonly store = createStore<{ state: SessionState }>(() => ({ state: { kind: 'unknown' } }));
  private accessToken: string | undefined;
  private refreshing: Promise<boolean> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    setAuthHooks({
      authorization: () => (this.accessToken === undefined ? undefined : `Bearer ${this.accessToken}`),
      refreshAfter401: () => this.refresh(),
    });
  }

  readonly getState = (): SessionState => this.store.getState().state;

  private set(state: SessionState): void {
    this.store.setState({ state });
  }

  // ------------------------------------------------------------ actions

  /** On page load: a valid refresh cookie signs the user in again. */
  async restore(): Promise<void> {
    if (this.getState().kind !== 'unknown') {
      return;
    }
    if (!(await this.refresh())) {
      this.set({ kind: 'signed-out' });
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    const res = await request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    });
    await this.accept(res.body);
  }

  async register(email: string, password: string, displayName: string | undefined): Promise<void> {
    await request('/auth/register', {
      method: 'POST',
      body: { email, password, ...(displayName === undefined || displayName === '' ? {} : { displayName }) },
      anonymous: true,
    });
    await this.signIn(email, password);
  }

  async signOut(): Promise<void> {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // Signing out locally is what matters; the server session expires on its own.
    }
    this.clear();
  }

  /** Erases the account in every service (identity anonymises, places erases on the event). */
  async deleteAccount(): Promise<void> {
    await request('/users/me', { method: 'DELETE' });
    this.clear();
  }

  async updateDisplayName(displayName: string | null): Promise<void> {
    const res = await request<UserProfile>('/users/me', { method: 'PATCH', body: { displayName } });
    this.set({ kind: 'signed-in', user: res.body });
  }

  /**
   * New access token from the refresh cookie. Single flight in the tab, serialised across tabs.
   * false = no valid session (the user is signed out).
   */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.locked(async () => {
      try {
        const res = await request<TokenResponse>('/auth/refresh', { method: 'POST', anonymous: true });
        await this.accept(res.body);
        return true;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          this.clear();
          return false;
        }
        // Network or server trouble: keep the user, the next call tries again.
        return this.getState().kind === 'signed-in';
      }
    }).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  // ------------------------------------------------------------ internals

  private async accept(tokens: TokenResponse): Promise<void> {
    this.accessToken = tokens.accessToken;
    clearTimeout(this.timer);
    const inMs = Math.max(5, tokens.expiresIn - EARLY_S) * 1000;
    this.timer = setTimeout(() => void this.refresh(), inMs);
    if (this.getState().kind !== 'signed-in') {
      const me = await request<UserProfile>('/users/me', { noRefresh: true });
      this.set({ kind: 'signed-in', user: me.body });
    }
  }

  private clear(): void {
    this.accessToken = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.set({ kind: 'signed-out' });
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks === undefined ? fn() : (locks.request(LOCK, fn) as Promise<T>);
  }
}

export const session = new Session();
