import { useCallback, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';

/**
 * Last values chosen in this tab, per page and parameter: coming back to a list through the menu
 * (a link without a query string) restores its filter and sort order.
 */
const remembered = new Map<string, string>();

/** Forgets the remembered settings (tests start from a clean tab). */
export function forgetParams(): void {
  remembered.clear();
}

/**
 * A view setting kept in the query string (filter, sort order), so it survives navigation,
 * reload and sharing. The default value is not written to the URL.
 */
export function useParam<T extends string>(name: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const key = `${pathname}?${name}`;
  const valid = (v: string | null | undefined): v is T =>
    v !== null && v !== undefined && (allowed === undefined || allowed.includes(v as T));
  const raw = params.get(name);
  const memory = remembered.get(key);
  const value = valid(raw) ? raw : valid(memory) ? memory : fallback;

  const write = useCallback(
    (next: T) =>
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next === fallback) {
            updated.delete(name);
          } else {
            updated.set(name, next);
          }
          return updated;
        },
        { replace: true },
      ),
    [name, fallback, setParams],
  );

  // A value in the address (also from a shared link) is remembered; arriving without the
  // parameter after choosing one earlier shows it in the address again.
  useEffect(() => {
    if (valid(raw)) {
      remembered.set(key, raw);
    } else if (raw === null && valid(memory) && memory !== fallback) {
      write(memory);
    }
    // valid() only depends on `allowed`, a constant list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, memory, fallback, write, key]);

  const set = useCallback(
    (next: T) => {
      remembered.set(key, next);
      write(next);
    },
    [key, write],
  );
  return [value, set];
}
