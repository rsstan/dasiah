// Notifications shown as toasts (global client state, Zustand). Anything can push one; the
// Toaster (shared/ui) shows them. Errors stay longer; identical messages are not stacked.
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ToastTone } from '../ui/Toast.tsx';

export interface Notice {
  id: number;
  tone: ToastTone;
  title?: string | undefined;
  message: string;
  /** Quoted to support, matches the server logs. */
  reference?: string | undefined;
}

interface State {
  notices: Notice[];
}

const LIFETIME_MS: Record<ToastTone, number> = { info: 5_000, success: 4_000, error: 9_000 };
const MAX = 4;
let nextId = 1;

export const notifications = createStore<State>(() => ({ notices: [] }));

export function dismiss(id: number): void {
  notifications.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

export function notify(notice: Omit<Notice, 'id'>): number {
  const same = notifications.getState().notices.find((n) => n.message === notice.message && n.tone === notice.tone);
  if (same !== undefined) {
    return same.id;
  }
  const id = nextId++;
  notifications.setState((s) => ({ notices: [...s.notices, { ...notice, id }].slice(-MAX) }));
  setTimeout(() => dismiss(id), LIFETIME_MS[notice.tone]);
  return id;
}

export function useNotices(): Notice[] {
  return useStore(notifications, (s) => s.notices);
}
