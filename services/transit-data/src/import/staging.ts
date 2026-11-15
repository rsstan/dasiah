// Staging layer: each needed GTFS file of the archive is streamed into its transit_staging table
// with COPY ... FROM STDIN. Columns are picked by header name (order and extra columns of the
// feed do not matter), the UTF-8 BOM is dropped, values are kept as text. Nothing is validated
// here: promote_feed does that.
import { basename } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PoolClient } from '@heatmap/common';
import { parse } from 'csv-parse';
import { from as copyFrom } from 'pg-copy-streams';
import yauzl from 'yauzl';
import { STAGED_FILES, type StagingTable } from '../repositories/schema.ts';

export class FeedFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FeedFormatError';
  }
}

const REQUIRED: readonly StagingTable[] = ['agency', 'routes', 'stops', 'trips', 'stop_times'];

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) =>
      error || zip === undefined
        ? reject(new FeedFormatError(`not a readable zip archive: ${error?.message ?? ''}`))
        : resolve(zip),
    );
  });
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error || stream === undefined ? reject(error) : resolve(stream)));
  });
}

/** Entries of the archive by staging table (files may sit in a sub-folder). */
async function listEntries(zip: yauzl.ZipFile): Promise<Map<StagingTable, yauzl.Entry>> {
  const found = new Map<StagingTable, yauzl.Entry>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = basename(entry.fileName).toLowerCase() as keyof typeof STAGED_FILES;
      const table = STAGED_FILES[name];
      if (table !== undefined && !entry.fileName.endsWith('/')) {
        found.set(table, entry);
      }
      zip.readEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', (error: Error) => reject(new FeedFormatError(`broken zip archive: ${error.message}`)));
    zip.readEntry();
  });
  return found;
}

function csvValue(value: string | undefined): string {
  if (value === undefined || value === '') {
    return ''; // NULL in COPY csv
  }
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Turns parsed GTFS records into COPY lines with the staging column order. */
function toCopyLines(feedVersionId: number, columns: readonly string[], file: string): Transform {
  let indexes: number[] | undefined;
  return new Transform({
    writableObjectMode: true,
    transform(record: string[], _encoding, callback) {
      if (indexes === undefined) {
        const header = record.map((h) => h.trim().toLowerCase());
        indexes = columns.map((c) => header.indexOf(c));
        callback();
        return;
      }
      if (record.length === 1 && record[0] === '') {
        callback();
        return;
      }
      const line = [String(feedVersionId), ...indexes.map((i) => csvValue(i === -1 ? undefined : record[i]))].join(',');
      callback(null, `${line}\n`);
    },
    flush(callback) {
      callback(indexes === undefined ? new FeedFormatError(`${file} is empty`) : null);
    },
  });
}

async function stagingColumns(client: PoolClient, table: StagingTable): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'transit_staging' AND table_name = $1 AND column_name <> 'feed_version_id'
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

/** Streams the archive into staging; returns the rows copied per table. */
export async function stageArchive(
  client: PoolClient,
  feedVersionId: number,
  zipFile: string,
): Promise<Record<string, number>> {
  const zip = await openZip(zipFile);
  try {
    const entries = await listEntries(zip);
    const missing = REQUIRED.filter((t) => !entries.has(t));
    if (!entries.has('calendar') && !entries.has('calendar_dates')) {
      missing.push('calendar');
    }
    if (missing.length > 0) {
      throw new FeedFormatError(`required files missing: ${missing.map((t) => `${t}.txt`).join(', ')}`);
    }
    const counts: Record<string, number> = {};
    for (const [table, entry] of entries) {
      const columns = await stagingColumns(client, table);
      const copy = client.query(
        copyFrom(`COPY transit_staging.${table} (feed_version_id, ${columns.join(', ')}) FROM STDIN WITH (FORMAT csv)`),
      );
      try {
        await pipeline(
          await openEntry(zip, entry),
          parse({ bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }),
          toCopyLines(feedVersionId, columns, entry.fileName),
          copy,
        );
      } catch (error) {
        if (error instanceof FeedFormatError) {
          throw error;
        }
        throw new FeedFormatError(`${entry.fileName}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
      counts[table] = Number(copy.rowCount);
    }
    return counts;
  } finally {
    zip.close();
  }
}
