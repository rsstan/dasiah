// The heading of a page: one <h1> per page (visible, or for screen readers only), the document
// title ("Saved places · Transit Heatmap"), and the target of the focus after a route change, so
// keyboard and screen-reader users start at the new page instead of the old link.
import { useEffect, useRef, type ReactNode } from 'react';
import { takePageFocus } from '../lib/pageFocus.ts';

export const APP_NAME = 'Transit Heatmap';

interface Props {
  /** Document title part; the heading text unless children are given. */
  title: string;
  children?: ReactNode;
  /** Shown on the page; otherwise for screen readers only. */
  visible?: boolean;
  id?: string;
  className?: string;
}

export function PageTitle({ title, children, visible = false, id, className }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;
  }, [title]);
  useEffect(() => {
    if (takePageFocus()) {
      heading.current?.focus();
    }
  }, []);
  return (
    <h1 ref={heading} id={id} tabIndex={-1} className={visible ? className : 'visually-hidden'}>
      {children ?? title}
    </h1>
  );
}
