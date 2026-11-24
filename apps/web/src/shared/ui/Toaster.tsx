// Where toasts appear (bottom right, above the map): a polite live region, so screen readers
// announce them without moving the focus.
import { dismiss, useNotices } from '../notifications/store.ts';
import { Toast } from './Toast.tsx';
import './Toaster.css';

export function Toaster() {
  const notices = useNotices();
  return (
    <div className="ui-toaster" aria-live="polite">
      {notices.map((n) => (
        <Toast key={n.id} tone={n.tone} title={n.title} onClose={() => dismiss(n.id)}>
          {n.message}
          {n.reference !== undefined && <span className="ui-toaster__ref">Reference: {n.reference}</span>}
        </Toast>
      ))}
    </div>
  );
}
