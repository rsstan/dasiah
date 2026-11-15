// Administrator: coverage of each city, import of a feed source, feed versions with their
// import status, activation of a validated version. Routes are admin-only at the gateway; the tab
// is shown only to admins.
import type { GatewayApi } from '@heatmap/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { describeError, request } from '../api/client.ts';
import type { City } from '../api/types.ts';

type Schemas = GatewayApi.components['schemas'];
export type FeedVersion = Schemas['FeedVersion'];
type FeedStatus = Schemas['FeedStatus'];
type ImportAccepted = Schemas['ImportAccepted'];
type CityCoverage = Schemas['CityCoverage'];

/** Statuses of an import still in progress: the list is polled while one is present. */
export const IN_PROGRESS: readonly FeedStatus[] = ['downloaded', 'staged'];
const STATUSES: readonly FeedStatus[] = ['downloaded', 'staged', 'validated', 'active', 'archived', 'failed'];
const POLL_MS = 3_000;

export function sourcesOf(versions: readonly FeedVersion[]): string[] {
  return [...new Set(versions.map((v) => v.sourceCode))].sort();
}

export function AdminView({ cities }: { cities: readonly City[] }) {
  const [versions, setVersions] = useState<FeedVersion[]>([]);
  const [filter, setFilter] = useState<{ status: FeedStatus | ''; source: string }>({ status: '', source: '' });
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    request<{ items: FeedVersion[] }>('/admin/feed-versions', {
      query: { limit: 100, status: filter.status, source: filter.source },
      signal: controller.signal,
    }).then(
      (res) => {
        setVersions(res.body.items);
        setListError(undefined);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setListError(describeError(error));
        }
      },
    );
    return () => controller.abort();
  }, [filter, version]);

  const running = versions.some((v) => IN_PROGRESS.includes(v.status));
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  return (
    <section className="admin list-view" aria-label="Administration">
      <h2>Administration</h2>
      <Coverage cities={cities} version={version} />
      <ImportForm sources={sourcesOf(versions)} onStarted={reload} />
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
            onChanged={reload}
          />
        ))}
      </ul>
      {versions.length === 0 && listError === undefined && <p className="hint">No feed versions.</p>}
    </section>
  );
}

function Coverage({ cities, version }: { cities: readonly City[]; version: number }) {
  const [rows, setRows] = useState<Record<string, CityCoverage | string>>({});
  useEffect(() => {
    const controller = new AbortController();
    for (const city of cities) {
      request<CityCoverage>(`/cities/${city.code}/coverage`, { signal: controller.signal }).then(
        (res) => setRows((r) => ({ ...r, [city.code]: res.body })),
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setRows((r) => ({ ...r, [city.code]: describeError(error) }));
          }
        },
      );
    }
    return () => controller.abort();
  }, [cities, version]);

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

function ImportForm({ sources, onStarted }: { sources: readonly string[]; onStarted: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | undefined>(undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await request<ImportAccepted>(`/admin/feed-sources/${encodeURIComponent(code.trim())}/import`, {
        method: 'POST',
      });
      setMessage({
        error: false,
        text: res.body.duplicate
          ? `The publisher still serves the archive of version ${res.body.feedVersionId}; nothing changed.`
          : `Downloaded as version ${res.body.feedVersionId}; the import runs in the background.`,
      });
      onStarted();
    } catch (err) {
      setMessage({ error: true, text: describeError(err) });
    } finally {
      setBusy(false);
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

function VersionItem({
  version: v,
  cityName,
  onChanged,
}: {
  version: FeedVersion;
  cityName: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const activate = async () => {
    if (!window.confirm(`Activate version ${v.feedVersionId} for ${cityName}? New maps of the city will use it.`)) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await request(`/admin/feed-versions/${v.feedVersionId}/activate`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
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
