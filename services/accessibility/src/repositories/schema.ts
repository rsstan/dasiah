// Kysely types of schema `accessibility` (services/accessibility/migrations).
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface RatioClassesTable {
  class_id: number;
  code: string;
  label: string;
  min_ratio: string | null;
  max_ratio: string | null;
  color: string;
  sort_order: number;
}

export interface FeedSnapshotsTable {
  feed_version_id: number;
  city_code: string;
  valid_from: string;
  valid_to: string;
  loaded_at: Generated<Date>;
  is_current: Generated<boolean>;
}

export interface CalculationsTable {
  calculation_id: Generated<string>;
  feed_version_id: number;
  origin_h3: string;
  service_date: string;
  departure_s: number;
  window_s: Generated<number>;
  algo_version: number;
  status: Generated<string>;
  created_at: Generated<Date>;
  completed_at: Timestamp | null;
  expires_at: Timestamp;
  error_code: string | null;
}

export interface CalculationResultsTable {
  calculation_id: string;
  h3_index: string;
  transit_s: number | null;
  car_s: number | null;
  has_stop: boolean;
}

export interface CalculationResultsView {
  calculation_id: string;
  h3_index: string;
  transit_s: number | null;
  car_s: number | null;
  ratio: string | null;
  class_code: string;
  color: string;
}

export interface AccessibilityDb {
  'accessibility.ratio_classes': RatioClassesTable;
  'accessibility.feed_snapshots': FeedSnapshotsTable;
  'accessibility.calculations': CalculationsTable;
  'accessibility.calculation_results': CalculationResultsTable;
  'accessibility.v_calculation_results': CalculationResultsView;
}
