// Administrator: coverage of each city, import of a feed source, feed versions with their
// import status, activation of a validated version. Routes are admin-only at the gateway; the tab
// is shown only to admins.
import { useState, type FormEvent } from 'react';
import { ApiError, describeError } from '../../shared/api/client.ts';
import type { City } from '../../models/types.ts';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Select,
  Skeleton,
  Table,
  TextField,
  type BadgeTone,
} from '../../shared/ui/index.ts';
import {
  IN_PROGRESS,
  useActivateVersion,
  useCoverage,
  useFeedVersions,
  useImportFeed,
  type FeedStatus,
  type FeedVersion,
  type VersionFilter,
} from './api.ts';

export type { FeedVersion } from './api.ts';

const STATUSES: readonly FeedStatus[] = ['downloaded', 'staged', 'validated', 'active', 'archived', 'failed'];

export function sourcesOf(versions: readonly FeedVersion[]): string[] {
  return [...new Set(versions.map((v) => v.sourceCode))].sort();
}

export function AdminView({ cities }: { cities: readonly City[] }) {
  const [filter, setFilter] = useState<VersionFilter>({ status: '', source: '' });
  const query = useFeedVersions(filter);
  const versions = query.data ?? [];
  const listError = query.isError ? describeError(query.error) : undefined;
  const running = versions.some((v) => IN_PROGRESS.includes(v.status));

  return (
    <Card className="admin list-view" aria-label="Administration" title="Administration">
      <Coverage cities={cities} />
      <ImportForm sources={sourcesOf(versions)} />
      <h3>Feed versions</h3>
      <div className="filters">
        <Select
          label="Status"
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value as FeedStatus | '' })}
        >
          <option value="">all</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select label="Source" value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
          <option value="">all</option>
          {sourcesOf(versions).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      {running && <p className="hint">An import is running; the list refreshes every few seconds.</p>}
      {query.isPending && <Skeleton lines={2} variant="card" />}
      {listError !== undefined && <p className="form-error">{listError}</p>}
      <ul className="items">
        {versions.map((v) => (
          <VersionItem
            key={v.feedVersionId}
            version={v}
            cityName={cities.find((c) => c.code === v.cityCode)?.name ?? v.cityCode}
          />
        ))}
      </ul>
      {!query.isPending && versions.length === 0 && listError === undefined && (
        <p className="hint">No feed versions.</p>
      )}
    </Card>
  );
}

/** Colour of a feed status. */
export const STATUS_TONE: Record<FeedStatus, BadgeTone> = {
  active: 'success',
  validated: 'info',
  downloaded: 'warning',
  staged: 'warning',
  archived: 'neutral',
  failed: 'danger',
};

function Coverage({ cities }: { cities: readonly City[] }) {
  const results = useCoverage(cities);
  const rows = cities.map((city, i) => {
    const result = results[i];
    return {
      city,
      data: result?.data,
      note:
        result?.isError === true
          ? result.error instanceof ApiError && result.error.status === 404
            ? 'no timetable'
            : describeError(result.error)
          : result?.isPending === true
            ? '…'
            : '—',
    };
  });
  type Row = (typeof rows)[number];
  return (
    <Table<Row>
      className="coverage"
      caption="Active timetables"
      rows={rows}
      rowKey={(r) => r.city.code}
      columns={[
        { header: 'City', rowHeader: true, cell: (r) => r.city.name },
        { header: 'Version', optional: true, align: 'end', cell: (r) => r.data?.feedVersionId ?? r.note },
        { header: 'Stops', align: 'end', cell: (r) => r.data?.stops.toLocaleString('en') ?? '—' },
        { header: 'Trips', align: 'end', cell: (r) => r.data?.trips.toLocaleString('en') ?? '—' },
        {
          header: 'Cells with a stop',
          align: 'end',
          cell: (r) =>
            r.data === undefined || r.data.hexTotal === 0
              ? '—'
              : `${Math.round((100 * r.data.hexWithStop) / r.data.hexTotal)} %`,
        },
      ]}
    />
  );
}

function ImportForm({ sources }: { sources: readonly string[] }) {
  const [code, setCode] = useState('');
  const importFeed = useImportFeed();
  const busy = importFeed.isPending;
  const [message, setMessage] = useState<{ error: boolean; text: string } | undefined>(undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(undefined);
    try {
      const accepted = await importFeed.mutateAsync(code.trim());
      setMessage({
        error: false,
        text: accepted.duplicate
          ? `The publisher still serves the archive of version ${accepted.feedVersionId}; nothing changed.`
          : `Downloaded as version ${accepted.feedVersionId}; the import runs in the background.`,
      });
    } catch (err) {
      setMessage({ error: true, text: describeError(err) });
    }
  };

  return (
    <form className="form import" onSubmit={(e) => void submit(e)}>
      <h3>Import</h3>
      <TextField
        label="Feed source"
        type="text"
        list="feed-sources"
        required
        pattern="[a-z0-9_]+"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="e.g. vno_vvt"
      />
      <datalist id="feed-sources">
        {sources.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div>
        <Button type="submit" variant="primary" loading={busy} disabled={code.trim() === ''}>
          Download and import
        </Button>
      </div>
      {message !== undefined && (
        <p className={message.error ? 'form-error' : 'hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </form>
  );
}

function VersionItem({ version: v, cityName }: { version: FeedVersion; cityName: string }) {
  const activation = useActivateVersion();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const activate = async () => {
    setError(undefined);
    try {
      await activation.mutateAsync(v.feedVersionId);
      setConfirming(false);
    } catch (err) {
      setConfirming(false);
      setError(describeError(err));
    }
  };
  return (
    <li className="version">
      <div className="version-head">
        <strong>
          #{v.feedVersionId} · {cityName}
        </strong>
        <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>
      </div>
      <span className="meta">
        {v.sourceCode} · fetched {new Date(v.fetchedAt).toLocaleString()}
      </span>
      {v.validFrom !== null && (
        <span className="meta">
          valid {v.validFrom} – {v.validTo}
        </span>
      )}
      {v.activatedAt !== null && <span className="meta">activated {new Date(v.activatedAt).toLocaleString()}</span>}
      <span className="meta mono" title={v.sha256}>
        sha256 {v.sha256.slice(0, 12)}…
      </span>
      {v.errorMessage !== null && <span className="form-error">{v.errorMessage}</span>}
      {v.status === 'validated' && (
        <Button variant="primary" size="sm" onClick={() => setConfirming(true)}>
          Activate
        </Button>
      )}
      {error !== undefined && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
      <Dialog
        open={confirming}
        title={`Activate version ${v.feedVersionId}?`}
        confirmLabel="Activate"
        busy={activation.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void activate()}
      >
        New maps of {cityName} will use this timetable; the current one is archived.
      </Dialog>
    </li>
  );
}
