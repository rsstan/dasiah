// Administrator: coverage of each city, import of a feed source, feed versions with their
// import status, activation of a validated version. Routes are admin-only at the gateway; the tab
// is shown only to admins.
import { useState, type FormEvent } from 'react';
import { describeError } from '../../shared/api/client.ts';
import type { City } from '../../models/types.ts';
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
    <section className="admin list-view" aria-label="Administration">
      <h2>Administration</h2>
      <Coverage cities={cities} />
      <ImportForm sources={sourcesOf(versions)} />
      <h3>Feed versions</h3>
      <div className="filters">
        <label>
          Status
          <select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value as FeedStatus | '' })}
          >
            <option value="">all</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
            <option value="">all</option>
            {sourcesOf(versions).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      {running && <p className="hint">An import is running; the list refreshes every few seconds.</p>}
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
      {versions.length === 0 && listError === undefined && <p className="hint">No feed versions.</p>}
    </section>
  );
}

type CityCoverageRow = NonNullable<ReturnType<typeof useCoverage>[number]['data']> | string | undefined;

function Coverage({ cities }: { cities: readonly City[] }) {
  const results = useCoverage(cities);
  const rows: Record<string, CityCoverageRow> = {};
  cities.forEach((city, i) => {
    const result = results[i];
    rows[city.code] = result?.data ?? (result?.isError === true ? describeError(result.error) : undefined);
  });
  return (
    <table className="coverage">
      <caption>Active timetables</caption>
      <thead>
        <tr>
          <th scope="col">City</th>
          <th scope="col">Version</th>
          <th scope="col">Stops</th>
          <th scope="col">Trips</th>
          <th scope="col">Cells with a stop</th>
        </tr>
      </thead>
      <tbody>
        {cities.map((city) => {
          const row = rows[city.code];
          return (
            <tr key={city.code}>
              <th scope="row">{city.name}</th>
              {typeof row === 'object' ? (
                <>
                  <td>{row.feedVersionId}</td>
                  <td>{row.stops.toLocaleString('en')}</td>
                  <td>{row.trips.toLocaleString('en')}</td>
                  <td>{row.hexTotal === 0 ? '—' : `${Math.round((100 * row.hexWithStop) / row.hexTotal)} %`}</td>
                </>
              ) : (
                <td colSpan={4} className="hint">
                  {row ?? '…'}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
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
      <label>
        Feed source
        <input
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
      </label>
      <button type="submit" className="primary" disabled={busy || code.trim() === ''}>
        {busy ? 'Downloading…' : 'Download and import'}
      </button>
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
  const busy = activation.isPending;
  const [error, setError] = useState<string | undefined>(undefined);
  const activate = async () => {
    if (!window.confirm(`Activate version ${v.feedVersionId} for ${cityName}? New maps of the city will use it.`)) {
      return;
    }
    setError(undefined);
    try {
      await activation.mutateAsync(v.feedVersionId);
    } catch (err) {
      setError(describeError(err));
    }
  };
  return (
    <li className="version">
      <div className="version-head">
        <strong>
          #{v.feedVersionId} · {cityName}
        </strong>
        <span className={`badge status-${v.status}`}>{v.status}</span>
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
        <button type="button" className="primary" disabled={busy} onClick={() => void activate()}>
          Activate
        </button>
      )}
      {error !== undefined && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
