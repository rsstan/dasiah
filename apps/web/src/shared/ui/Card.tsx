import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

/** A surface for a block of content, optionally with a heading. */
export function Card({
  title,
  actions,
  className,
  children,
  ...rest
}: { title?: ReactNode; actions?: ReactNode } & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section {...rest} className={['ui-card', className ?? ''].filter(Boolean).join(' ')}>
      {(title !== undefined || actions !== undefined) && (
        <header className="ui-card__header">
          {title !== undefined && <h2 className="ui-card__title">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
