import { check, pattern, required } from '../../shared/lib/validation.ts';

/** Feed source codes as in transit.feed_sources: lowercase letters, digits, underscore. */
export function validateSourceCode(code: string): string | undefined {
  return check(
    { code },
    {
      code: [required('A feed source'), pattern(/^[a-z0-9_]+$/, 'Use lowercase letters, digits and _ (e.g. vno_vvt).')],
    },
  ).code;
}
