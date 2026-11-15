import { useEffect, useState } from 'react';
import { describeError, request } from './client.ts';

export type Loadable<T> = { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'error'; message: string };

/** GET on mount and whenever `path` changes; loading until the answer for this path arrives. */
export function useGet<T>(path: string): Loadable<T> {
  const [result, setResult] = useState<{ path: string; value: Loadable<T> } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    request<T>(path, { signal: controller.signal }).then(
      (res) => setResult({ path, value: { kind: 'ready', data: res.body } }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ path, value: { kind: 'error', message: describeError(error) } });
        }
      },
    );
    return () => controller.abort();
  }, [path]);
  return result?.path === path ? result.value : { kind: 'loading' };
}
