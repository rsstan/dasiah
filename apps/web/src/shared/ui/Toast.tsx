// A notification card. Placed by the notification centre (shared/ui Toaster, 8A.4).
import type { ReactNode } from 'react';
import './Toast.css';

export type ToastTone = 'info' | 'success' | 'error';

interface Props {
  tone?: ToastTone;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}

export function Toast({ tone = 'info', title, children, onClose }: Props) {
  return (
    <div className={`ui-toast ui-toast--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="ui-toast__body">
        {title !== undefined && <strong className="ui-toast__title">{title}</strong>}
        <div>{children}</div>
      </div>
      {onClose !== undefined && (
        <button type="button" className="ui-toast__close" aria-label="Dismiss" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}
