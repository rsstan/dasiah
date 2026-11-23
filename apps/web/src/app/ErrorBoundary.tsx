// Last line of defence against render errors. A route's error ends at RouteError (inside the
// layout, so the menu stays); anything else at AppErrorBoundary. Both log the error with a
// reference and show what to do instead of a blank page.
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { logger } from '../shared/lib/logger.ts';
import { Button, ButtonLink } from '../shared/ui/index.ts';

function newReference(): string {
  return crypto.randomUUID().slice(0, 8);
}

function Fallback({ code, title, text, reference }: { code: string; title: string; text: string; reference?: string }) {
  return (
    <section className="status-page" role="alert" aria-labelledby="error-title">
      <p className="status-code">{code}</p>
      <h2 id="error-title">{title}</h2>
      <p className="hint">{text}</p>
      {reference !== undefined && <p className="hint">Reference: {reference}</p>}
      <div className="actions">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
        <ButtonLink to="/">See all cities</ButtonLink>
      </div>
    </section>
  );
}

/** errorElement of the routes: a page that failed to render, or an unmatched route. */
export function RouteError() {
  const error = useRouteError();
  const [ref] = useState(newReference);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  useEffect(() => {
    if (!notFound) {
      logger.error('page failed to render', { ref, error: error instanceof Error ? error.message : String(error) });
    }
  }, [error, notFound, ref]);
  if (notFound) {
    return <Fallback code="404" title="Page not found" text="There is nothing at this address." />;
  }
  return (
    <Fallback
      code="Error"
      title="This page failed"
      text="Something went wrong while showing this page."
      reference={ref}
    />
  );
}

interface State {
  ref: string | undefined;
}

/** Around the whole application (also outside the router). */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { ref: undefined };

  static getDerivedStateFromError(): State {
    return { ref: newReference() };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('application failed to render', {
      ref: this.state.ref,
      error: error.message,
      component: info.componentStack?.trim().split('\n')[0],
    });
  }

  override render(): ReactNode {
    if (this.state.ref === undefined) {
      return this.props.children;
    }
    return (
      <div className="site">
        <main className="site-main page">
          <section className="status-page" role="alert" aria-labelledby="app-error-title">
            <p className="status-code">Error</p>
            <h2 id="app-error-title">The application failed</h2>
            <p className="hint">Reload the page. If it happens again, quote this reference: {this.state.ref}</p>
            <div className="actions">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload the page
              </Button>
            </div>
          </section>
        </main>
      </div>
    );
  }
}
