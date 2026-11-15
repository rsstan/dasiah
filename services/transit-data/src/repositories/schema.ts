// Kysely types of schemas `transit` and `transit_staging` (services/transit-data/migrations).
import type { ColumnType, Generated } from 'kysely';

type Geo = ColumnType<string, string, string>;

export interface CitiesTable {
  city_id: number;
  code: string;
  name: string;
  country_code: string;
  timezone: string;
  h3_resolution: number;
  bounds: Geo;
  is_enabled: boolean;
}

export interface FeedSourcesTable {
  feed_source_id: number;
  city_id: number;
  code: string;
  name: string;
  url: string;
  license: string;
  is_enabled: boolean;
}

export interface FeedVersionsTable {
  feed_version_id: Generated<number>;
  feed_source_id: number;
  sha256: Buffer;
  storage_key: string;
  fetched_at: Generated<Date>;
  valid_from: string | null;
  valid_to: string | null;
  status: Generated<string>;
  activated_at: Date | null;
  archived_at: Date | null;
  error_message: string | null;
}

export interface HexCellsTable {
  h3_index: string;
  city_id: number;
  centroid: Geo;
}

export interface HexStopAccessTable {
  feed_version_id: number;
  h3_index: string;
  stop_id: number;
  walk_s: number;
}

export interface StopsTable {
  feed_version_id: number;
  stop_id: number;
  gtfs_id: string;
  name: string;
  geom: Geo;
}

export interface TransfersTable {
  feed_version_id: number;
  from_stop_id: number;
  to_stop_id: number;
  walk_s: number;
}

export interface CityCoverageView {
  city_code: string;
  feed_version_id: number;
  hex_total: number;
  hex_with_stop: number;
  stops: number;
  routes: number;
  trips: number;
}

export interface ActiveFeedsView {
  city_code: string;
  source_code: string;
  feed_version_id: number;
  valid_from: string;
  valid_to: string;
  activated_at: Date;
}

export interface TransitDb {
  'transit.cities': CitiesTable;
  'transit.feed_sources': FeedSourcesTable;
  'transit.feed_versions': FeedVersionsTable;
  'transit.hex_cells': HexCellsTable;
  'transit.hex_stop_access': HexStopAccessTable;
  'transit.stops': StopsTable;
  'transit.transfers': TransfersTable;
  'transit.mv_city_coverage': CityCoverageView;
  'transit.v_active_feeds': ActiveFeedsView;
}

/** GTFS files staged by an import, with the staging table of each. */
export const STAGED_FILES = {
  'agency.txt': 'agency',
  'routes.txt': 'routes',
  'stops.txt': 'stops',
  'trips.txt': 'trips',
  'stop_times.txt': 'stop_times',
  'calendar.txt': 'calendar',
  'calendar_dates.txt': 'calendar_dates',
} as const;

export type StagingTable = (typeof STAGED_FILES)[keyof typeof STAGED_FILES];
