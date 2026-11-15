-- Up Migration
-- Descriptions for every column (and table) that had none, so the data dictionary is complete.

COMMENT ON TABLE  accessibility.pgmigrations IS 'Migration history of the accessibility schema, maintained by node-pg-migrate.';
COMMENT ON COLUMN accessibility.pgmigrations.id IS 'Surrogate key in the order migrations were applied.';
COMMENT ON COLUMN accessibility.pgmigrations.name IS 'Migration file name without extension, e.g. 0001_init.';
COMMENT ON COLUMN accessibility.pgmigrations.run_on IS 'When the migration was applied (server local time).';

COMMENT ON COLUMN accessibility.ratio_classes.class_id IS 'Stable numeric id of the legend class.';
COMMENT ON COLUMN accessibility.ratio_classes.code IS 'Machine name returned by the API, e.g. good, no_transit.';
COMMENT ON COLUMN accessibility.ratio_classes.label IS 'Legend text shown to the user.';
COMMENT ON COLUMN accessibility.ratio_classes.color IS 'Fill colour as #rrggbb (lower case).';
COMMENT ON COLUMN accessibility.ratio_classes.sort_order IS 'Position in the legend, best class first.';

COMMENT ON COLUMN accessibility.feed_snapshots.feed_version_id IS 'Logical reference to transit.feed_versions.feed_version_id.';
COMMENT ON COLUMN accessibility.feed_snapshots.city_code IS 'City the timetable belongs to (waw, vno).';
COMMENT ON COLUMN accessibility.feed_snapshots.valid_from IS 'First service date covered by the timetable.';
COMMENT ON COLUMN accessibility.feed_snapshots.valid_to IS 'Last service date covered by the timetable.';
COMMENT ON COLUMN accessibility.feed_snapshots.loaded_at IS 'When this service finished loading the timetable into memory.';
COMMENT ON COLUMN accessibility.feed_snapshots.is_current IS 'true = the snapshot used for new calculations in its city (one per city).';

COMMENT ON COLUMN accessibility.calculations.calculation_id IS 'Id returned to the client and used in result URLs.';
COMMENT ON COLUMN accessibility.calculations.feed_version_id IS 'Timetable snapshot used; determines the city.';
COMMENT ON COLUMN accessibility.calculations.service_date IS 'Local service date of the departure.';
COMMENT ON COLUMN accessibility.calculations.status IS 'running -> done | failed; enforced by trigger calculations_status.';
COMMENT ON COLUMN accessibility.calculations.created_at IS 'When the request was accepted.';
COMMENT ON COLUMN accessibility.calculations.completed_at IS 'When the status left running; set by trigger.';
COMMENT ON COLUMN accessibility.calculations.expires_at IS 'After this moment the row is removed by purge_expired().';
COMMENT ON COLUMN accessibility.calculations.error_code IS 'Machine-readable failure reason when status = failed, e.g. osrm_unavailable.';

COMMENT ON COLUMN accessibility.calculation_results.calculation_id IS 'Calculation the row belongs to.';
COMMENT ON COLUMN accessibility.calculation_results.h3_index IS 'Destination cell (resolution of the city grid).';

COMMENT ON TABLE  accessibility.outbox IS 'Transactional outbox: events written in the same transaction as the state change.';
COMMENT ON COLUMN accessibility.outbox.event_id IS 'Message id; consumers use it for deduplication.';
COMMENT ON COLUMN accessibility.outbox.event_type IS 'Routing key, e.g. accessibility.calculation.completed.v1.';
COMMENT ON COLUMN accessibility.outbox.payload IS 'Event body. JSON is justified: structure is defined per event_type in contracts/asyncapi.';
COMMENT ON COLUMN accessibility.outbox.occurred_at IS 'When the state change happened.';
COMMENT ON COLUMN accessibility.outbox.published_at IS 'When the broker confirmed the message; NULL = pending.';

COMMENT ON COLUMN accessibility.processed_messages.message_id IS 'Envelope id of a consumed message.';
COMMENT ON COLUMN accessibility.processed_messages.event_type IS 'Routing key of the consumed message.';
COMMENT ON COLUMN accessibility.processed_messages.processed_at IS 'When the effect was committed.';

-- routines
COMMENT ON FUNCTION accessibility.tg_calculation_status() IS 'Trigger: a calculation leaves running exactly once; stamps completed_at.';
COMMENT ON FUNCTION accessibility.tg_snapshot_current() IS 'Trigger: marking a snapshot current clears the flag on the previous one of the same city.';

-- Down Migration
COMMENT ON FUNCTION accessibility.tg_snapshot_current() IS NULL;
COMMENT ON FUNCTION accessibility.tg_calculation_status() IS NULL;
COMMENT ON COLUMN accessibility.processed_messages.processed_at IS NULL;
COMMENT ON COLUMN accessibility.processed_messages.event_type IS NULL;
COMMENT ON COLUMN accessibility.processed_messages.message_id IS NULL;
COMMENT ON COLUMN accessibility.outbox.published_at IS NULL;
COMMENT ON COLUMN accessibility.outbox.occurred_at IS NULL;
COMMENT ON COLUMN accessibility.outbox.payload IS NULL;
COMMENT ON COLUMN accessibility.outbox.event_type IS NULL;
COMMENT ON COLUMN accessibility.outbox.event_id IS NULL;
COMMENT ON TABLE  accessibility.outbox IS NULL;
COMMENT ON COLUMN accessibility.calculation_results.h3_index IS NULL;
COMMENT ON COLUMN accessibility.calculation_results.calculation_id IS NULL;
COMMENT ON COLUMN accessibility.calculations.error_code IS NULL;
COMMENT ON COLUMN accessibility.calculations.expires_at IS NULL;
COMMENT ON COLUMN accessibility.calculations.completed_at IS NULL;
COMMENT ON COLUMN accessibility.calculations.created_at IS NULL;
COMMENT ON COLUMN accessibility.calculations.status IS NULL;
COMMENT ON COLUMN accessibility.calculations.service_date IS NULL;
COMMENT ON COLUMN accessibility.calculations.feed_version_id IS NULL;
COMMENT ON COLUMN accessibility.calculations.calculation_id IS NULL;
COMMENT ON COLUMN accessibility.feed_snapshots.is_current IS NULL;
COMMENT ON COLUMN accessibility.feed_snapshots.loaded_at IS NULL;
COMMENT ON COLUMN accessibility.feed_snapshots.valid_to IS NULL;
COMMENT ON COLUMN accessibility.feed_snapshots.valid_from IS NULL;
COMMENT ON COLUMN accessibility.feed_snapshots.city_code IS NULL;
COMMENT ON COLUMN accessibility.feed_snapshots.feed_version_id IS NULL;
COMMENT ON COLUMN accessibility.ratio_classes.sort_order IS NULL;
COMMENT ON COLUMN accessibility.ratio_classes.color IS NULL;
COMMENT ON COLUMN accessibility.ratio_classes.label IS NULL;
COMMENT ON COLUMN accessibility.ratio_classes.code IS NULL;
COMMENT ON COLUMN accessibility.ratio_classes.class_id IS NULL;
COMMENT ON COLUMN accessibility.pgmigrations.run_on IS NULL;
COMMENT ON COLUMN accessibility.pgmigrations.name IS NULL;
COMMENT ON COLUMN accessibility.pgmigrations.id IS NULL;
COMMENT ON TABLE  accessibility.pgmigrations IS NULL;
