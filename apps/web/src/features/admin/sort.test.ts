import { describe, expect, it } from 'vitest';
import type { FeedVersion } from './api.ts';
import { sortVersions } from './sort.ts';

describe('sorting feed versions', () => {
  const v = (feedVersionId: number, status: FeedVersion['status']): FeedVersion => ({
    feedVersionId,
    status,
    sourceCode: 'waw_ztm',
    cityCode: 'waw',
    sha256: 'a'.repeat(64),
    fetchedAt: '2026-11-01T00:00:00Z',
    validFrom: null,
    validTo: null,
    activatedAt: null,
    archivedAt: null,
    errorMessage: null,
  });
  const versions = [v(1, 'archived'), v(3, 'failed'), v(2, 'active'), v(4, 'validated')];
  it('orders by id or puts live versions first', () => {
    expect(sortVersions(versions, 'newest').map((x) => x.feedVersionId)).toEqual([4, 3, 2, 1]);
    expect(sortVersions(versions, 'oldest').map((x) => x.feedVersionId)).toEqual([1, 2, 3, 4]);
    expect(sortVersions(versions, 'status').map((x) => x.status)).toEqual([
      'active',
      'validated',
      'failed',
      'archived',
    ]);
  });
});
