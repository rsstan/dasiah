// A modal confirmation built on the native <dialog>: focus stays inside, Escape cancels, the
// page behind is dimmed and inert. Focus starts on the first button, "Cancel", so a confirmation
// of something destructive is never one Enter away.
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import './Dialog.css';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null || typeof dialog.showModal !== 'function') {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-labelledby="ui-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open && (
        <>
          <h2 id="ui-dialog-title" className="ui-dialog__title">
            {title}
          </h2>
          <div className="ui-dialog__body">{children}</div>
          <div className="ui-dialog__actions">
            <Button onClick={onCancel}>{cancelLabel}</Button>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
