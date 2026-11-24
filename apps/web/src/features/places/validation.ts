// Rules of the place forms (places contract: label 1..60).
import { ApiError } from '../../shared/api/client.ts';
import { check, maxLength, required } from '../../shared/lib/validation.ts';

export const LABEL_MAX = 60;

/** On "save" an empty name takes the kind's name; on "rename" a name is required. */
export function validateLabel(label: string, mode: 'save' | 'rename'): string | undefined {
  return check(
    { label },
    {
      label:
        mode === 'rename' ? [required('A name'), maxLength(LABEL_MAX, 'The name')] : [maxLength(LABEL_MAX, 'The name')],
    },
  ).label;
}

/** A 409 duplicate-label belongs to the name field. */
export function labelConflict(error: unknown): string | undefined {
  return error instanceof ApiError && error.type === '/problems/duplicate-label'
    ? 'You already have a place with this name.'
    : undefined;
}
