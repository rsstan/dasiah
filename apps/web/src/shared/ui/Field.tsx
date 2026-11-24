// Form fields of the kit. The label, hint and error are tied to the control (htmlFor,
// aria-describedby, aria-invalid), so assistive technology reads the error with the field.
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import './Field.css';

interface FieldText {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown under the field and announced; marks the control invalid. */
  error?: string | undefined;
}

function useFieldIds(error: string | undefined, hint: ReactNode) {
  const id = useId();
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { id, hintId, errorId, describedBy };
}

function FieldMessages({
  hint,
  hintId,
  error,
  errorId,
}: {
  hint: ReactNode;
  hintId?: string | undefined;
  error?: string | undefined;
  errorId?: string | undefined;
}) {
  return (
    <>
      {hint !== undefined && (
        <span id={hintId} className="ui-field__hint">
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span id={errorId} className="ui-field__error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

export type TextFieldProps = FieldText & Omit<InputHTMLAttributes<HTMLInputElement>, 'children'>;

export function TextField({ label, hint, error, className, id: _ignored, ...input }: TextFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(error, hint);
  return (
    <div className={['ui-field', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="ui-field__label">
        {label}
      </label>
      <input
        {...input}
        id={id}
        className="ui-field__control"
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy}
      />
      <FieldMessages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

export type SelectProps = FieldText & SelectHTMLAttributes<HTMLSelectElement> & { inline?: boolean };

export function Select({
  label,
  hint,
  error,
  className,
  inline = false,
  children,
  id: _ignored,
  ...select
}: SelectProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(error, hint);
  return (
    <div className={['ui-field', inline ? 'ui-field--inline' : '', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="ui-field__label">
        {label}
      </label>
      <select
        {...select}
        id={id}
        className="ui-field__control"
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy}
      >
        {children}
      </select>
      <FieldMessages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ...input
}: { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={['ui-checkbox', className ?? ''].filter(Boolean).join(' ')}>
      <input {...input} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}
