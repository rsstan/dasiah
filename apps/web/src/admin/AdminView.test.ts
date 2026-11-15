import { describe, expect, it } from 'vitest';
import { sourcesOf, type FeedVersion } from './AdminView.tsx';

const v = (feedVersionId: number, sourceCode: string): FeedVersion => ({
  feedVersionId,
  sourceCode,
  cityCode: 'vno',
  status: 'archived',
  sha256: 'a'.repeat(64),
  fetchedAt: '2026-11-15T10:00:00Z',
  validFrom: null,
  validTo: null,
  activatedAt: null,
  archivedAt: null,
  errorMessage: null,
});

describe('sourcesOf', () => {
  it('lists each source once, sorted', () => {
    expect(sourcesOf([v(3, 'waw_ztm'), v(2, 'vno_vvt'), v(1, 'waw_ztm')])).toEqual(['vno_vvt', 'waw_ztm']);
  });
});
