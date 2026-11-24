import type { FeedStatus, FeedVersion } from './api.ts';

export const VERSION_SORTS = ['newest', 'oldest', 'status'] as const;
export type VersionSort = (typeof VERSION_SORTS)[number];

export const VERSION_SORT_LABEL: Record<VersionSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  status: 'Status',
};

/** Live versions first: what an administrator acts on. */
const STATUS_ORDER: readonly FeedStatus[] = [
  'active',
  'validated',
  'staged',
  'downloaded',
  'downloading',
  'failed',
  'archived',
];

export function sortVersions(versions: readonly FeedVersion[], sort: VersionSort): FeedVersion[] {
  const newest = (a: FeedVersion, b: FeedVersion) => b.feedVersionId - a.feedVersionId;
  const compare: Record<VersionSort, (a: FeedVersion, b: FeedVersion) => number> = {
    newest,
    oldest: (a, b) => a.feedVersionId - b.feedVersionId,
    status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || newest(a, b),
  };
  return [...versions].sort(compare[sort]);
}
