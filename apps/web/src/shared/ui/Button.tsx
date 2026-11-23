// Buttons of the kit: one look for every action. `ButtonLink` is the same look on a router link.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md';

interface Look {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width of the container. */
  block?: boolean;
}

export function buttonClass({ variant = 'secondary', size = 'md', block = false }: Look, extra?: string): string {
  return ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, block ? 'ui-btn--block' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Look {
  /** Shows a spinner, sets aria-busy and blocks further clicks. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant,
  size,
  block,
  loading = false,
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={buttonClass({ variant, size, block }, className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="ui-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, block, className, ...rest }: LinkProps & Look) {
  return <Link {...rest} className={buttonClass({ variant, size, block }, className)} />;
}
