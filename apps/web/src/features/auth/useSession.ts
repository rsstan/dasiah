import { useStore } from 'zustand';
import { session, type SessionState } from './session.ts';

/** The signed-in user (or not), from the session store. */
export function useSession(): SessionState {
  return useStore(session.store, (s) => s.state);
}
