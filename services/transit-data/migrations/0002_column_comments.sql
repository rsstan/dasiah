-- Up Migration
-- Descriptions for every column (and table) that had none, so the data dictionary is complete.

COMMENT ON TABLE  transit.pgmigrations IS 'Migration history of the transit and transit_staging schemas, maintained by node-pg-migrate.';
COMMENT ON COLUMN transit.pgmigrations.id IS 'Surrogate key in the order migrations were applied.';
COMMENT ON COLUMN transit.pgmigrations.name IS 'Migration file name without extension, e.g. 0001_init.';
COMMENT ON COLUMN transit.pgmigrations.run_on IS 'When the migration was applied (server local time).';

-- reference
COMMENT ON COLUMN transit.route_types.route_type_id IS 'GTFS route_type value.';
COMMENT ON COLUMN transit.route_types.code IS 'Machine name of the mode, e.g. tram.';
COMMENT ON COLUMN transit.route_types.name IS 'Human-readable name of the mode.';

COMMENT ON COLUMN transit.cities.city_id IS 'Stable numeric id.';
COMMENT ON COLUMN transit.cities.code IS 'Three-letter city code used in the API and events (waw, vno).';
COMMENT ON COLUMN transit.cities.name IS 'City name in English.';
COMMENT ON COLUMN transit.cities.country_code IS 'ISO 3166-1 alpha-2 country code.';
COMMENT ON COLUMN transit.cities.timezone IS 'IANA time zone of the timetable, e.g. Europe/Warsaw.';
COMMENT ON COLUMN transit.cities.h3_resolution IS 'H3 resolution of the destination grid (9 = about 0.1 km2 per cell).';
COMMENT ON COLUMN transit.cities.is_enabled IS 'false = hidden from the city list.';

COMMENT ON COLUMN transit.feed_sources.feed_source_id IS 'Stable numeric id.';
COMMENT ON COLUMN transit.feed_sources.city_id IS 'City served by the feed.';
COMMENT ON COLUMN transit.feed_sources.code IS 'Machine name used in admin URLs, e.g. waw_ztm.';
COMMENT ON COLUMN transit.feed_sources.name IS 'Publisher or feed name.';
COMMENT ON COLUMN transit.feed_sources.url IS 'Download URL of the GTFS zip.';
COMMENT ON COLUMN transit.feed_sources.license IS 'Licence or terms of use of the data.';
COMMENT ON COLUMN transit.feed_sources.is_enabled IS 'false = excluded from scheduled imports.';

-- raw layer metadata
COMMENT ON COLUMN transit.feed_versions.feed_version_id IS 'Surrogate key; part of the key of every core GTFS row.';
COMMENT ON COLUMN transit.feed_versions.feed_source_id IS 'Source the archive was downloaded from.';
COMMENT ON COLUMN transit.feed_versions.fetched_at IS 'When the archive was downloaded.';
COMMENT ON COLUMN transit.feed_versions.valid_from IS 'First service date; set by promote_feed().';
COMMENT ON COLUMN transit.feed_versions.valid_to IS 'Last service date; set by promote_feed().';
COMMENT ON COLUMN transit.feed_versions.status IS 'downloaded -> staged -> validated -> active -> archived, or failed; enforced by trigger feed_versions_status.';
COMMENT ON COLUMN transit.feed_versions.activated_at IS 'When the version became active; set by trigger.';
COMMENT ON COLUMN transit.feed_versions.archived_at IS 'When the version was archived; set by trigger.';
COMMENT ON COLUMN transit.feed_versions.error_message IS 'Why the import failed; present exactly when status = failed.';

-- core GTFS
COMMENT ON TABLE  transit.agencies IS 'Core: GTFS agency.txt of one feed version.';
COMMENT ON COLUMN transit.agencies.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.agencies.agency_id IS 'Compact id assigned by promote_feed().';
COMMENT ON COLUMN transit.agencies.gtfs_id IS 'agency_id from the feed (''default'' when the feed leaves it empty).';
COMMENT ON COLUMN transit.agencies.name IS 'agency_name from the feed.';

COMMENT ON TABLE  transit.routes IS 'Core: GTFS routes.txt of one feed version.';
COMMENT ON COLUMN transit.routes.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.routes.route_id IS 'Compact id assigned by promote_feed().';
COMMENT ON COLUMN transit.routes.agency_id IS 'Operating agency.';
COMMENT ON COLUMN transit.routes.gtfs_id IS 'route_id from the feed.';
COMMENT ON COLUMN transit.routes.short_name IS 'Line number shown to riders, e.g. 175.';
COMMENT ON COLUMN transit.routes.long_name IS 'Descriptive line name; at least one of the two names is present.';
COMMENT ON COLUMN transit.routes.route_type_id IS 'Mode of transport.';

COMMENT ON TABLE  transit.stops IS 'Core: boarding locations from GTFS stops.txt (stations and entrances are skipped).';
COMMENT ON COLUMN transit.stops.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.stops.stop_id IS 'Compact id assigned by promote_feed(); RAPTOR uses it as an array index.';
COMMENT ON COLUMN transit.stops.gtfs_id IS 'stop_id from the feed.';
COMMENT ON COLUMN transit.stops.name IS 'stop_name from the feed.';
COMMENT ON COLUMN transit.stops.geom IS 'Stop position (WGS 84).';

COMMENT ON TABLE  transit.services IS 'Core: service ids from calendar.txt and calendar_dates.txt.';
COMMENT ON COLUMN transit.services.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.services.service_id IS 'Compact id assigned by promote_feed().';
COMMENT ON COLUMN transit.services.gtfs_id IS 'service_id from the feed.';

COMMENT ON COLUMN transit.service_dates.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.service_dates.service_id IS 'Service that runs on the date.';
COMMENT ON COLUMN transit.service_dates.service_date IS 'Local service date (trips may run past midnight of it).';

COMMENT ON TABLE  transit.trips IS 'Core: GTFS trips.txt of one feed version.';
COMMENT ON COLUMN transit.trips.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.trips.trip_id IS 'Compact id assigned by promote_feed().';
COMMENT ON COLUMN transit.trips.route_id IS 'Route the trip runs on.';
COMMENT ON COLUMN transit.trips.service_id IS 'Service that decides on which dates the trip runs.';
COMMENT ON COLUMN transit.trips.gtfs_id IS 'trip_id from the feed.';
COMMENT ON COLUMN transit.trips.headsign IS 'Destination shown on the vehicle.';
COMMENT ON COLUMN transit.trips.direction IS 'GTFS direction_id (0 or 1); NULL when the feed omits it.';

COMMENT ON TABLE  transit.stop_times IS 'Core: GTFS stop_times.txt, times converted to seconds of the service day.';
COMMENT ON COLUMN transit.stop_times.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.stop_times.trip_id IS 'Trip the call belongs to.';
COMMENT ON COLUMN transit.stop_times.stop_sequence IS 'Order of the call within the trip (increasing, not necessarily consecutive).';
COMMENT ON COLUMN transit.stop_times.stop_id IS 'Stop served.';
COMMENT ON COLUMN transit.stop_times.arrival_s IS 'Arrival, seconds of the service day; may exceed 86400 after midnight.';
COMMENT ON COLUMN transit.stop_times.departure_s IS 'Departure, seconds of the service day; not earlier than arrival_s.';

COMMENT ON COLUMN transit.transfers.feed_version_id IS 'Feed version the row belongs to.';
COMMENT ON COLUMN transit.transfers.from_stop_id IS 'Stop the walk starts at.';
COMMENT ON COLUMN transit.transfers.to_stop_id IS 'Stop the walk ends at.';
COMMENT ON COLUMN transit.transfers.walk_s IS 'Walking time in seconds (walk_seconds() of the straight-line distance).';

-- grid and mart
COMMENT ON COLUMN transit.hex_cells.h3_index IS 'H3 cell index.';
COMMENT ON COLUMN transit.hex_cells.city_id IS 'City whose grid the cell belongs to.';
COMMENT ON COLUMN transit.hex_cells.centroid IS 'Cell centre (WGS 84); start and end point of walking and driving legs.';

COMMENT ON COLUMN transit.hex_stop_access.feed_version_id IS 'Feed version whose stops were used.';
COMMENT ON COLUMN transit.hex_stop_access.h3_index IS 'Cell.';
COMMENT ON COLUMN transit.hex_stop_access.stop_id IS 'One of the nearest stops of the cell.';
COMMENT ON COLUMN transit.hex_stop_access.walk_s IS 'Walking time from the cell centre to the stop, seconds.';

COMMENT ON TABLE  transit.outbox IS 'Transactional outbox: events written in the same transaction as the state change.';
COMMENT ON COLUMN transit.outbox.event_id IS 'Message id; consumers use it for deduplication.';
COMMENT ON COLUMN transit.outbox.event_type IS 'Routing key, e.g. transit.feed.activated.v1.';
COMMENT ON COLUMN transit.outbox.payload IS 'Event body. JSON is justified: structure is defined per event_type in contracts/asyncapi.';
COMMENT ON COLUMN transit.outbox.occurred_at IS 'When the state change happened.';
COMMENT ON COLUMN transit.outbox.published_at IS 'When the broker confirmed the message; NULL = pending.';

-- staging: columns are the GTFS fields as text, exactly as published
COMMENT ON TABLE  transit_staging.agency IS 'Staging: agency.txt as loaded by COPY.';
COMMENT ON COLUMN transit_staging.agency.feed_version_id IS 'Feed version being imported.';
COMMENT ON COLUMN transit_staging.agency.agency_id IS 'GTFS agency_id (may be empty when the feed has one agency).';
COMMENT ON COLUMN transit_staging.agency.agency_name IS 'GTFS agency_name.';
COMMENT ON COLUMN transit_staging.agency.agency_timezone IS 'GTFS agency_timezone.';

COMMENT ON TABLE  transit_staging.routes IS 'Staging: routes.txt as loaded by COPY.';
COMMENT ON COLUMN transit_staging.routes.feed_version_id IS 'Feed version being imported.';
COMMENT ON COLUMN transit_staging.routes.route_id IS 'GTFS route_id.';
COMMENT ON COLUMN transit_staging.routes.agency_id IS 'GTFS agency_id (optional).';
COMMENT ON COLUMN transit_staging.routes.route_short_name IS 'GTFS route_short_name.';
COMMENT ON COLUMN transit_staging.routes.route_long_name IS 'GTFS route_long_name.';
COMMENT ON COLUMN transit_staging.routes.route_type IS 'GTFS route_type as text.';

COMMENT ON TABLE  transit_staging.stops IS 'Staging: stops.txt as loaded by COPY.';
COMMENT ON COLUMN transit_staging.stops.feed_version_id IS 'Feed version being imported.';
COMMENT ON COLUMN transit_staging.stops.stop_id IS 'GTFS stop_id.';
COMMENT ON COLUMN transit_staging.stops.stop_name IS 'GTFS stop_name.';
COMMENT ON COLUMN transit_staging.stops.stop_lat IS 'GTFS stop_lat as text.';
COMMENT ON COLUMN transit_staging.stops.stop_lon IS 'GTFS stop_lon as text.';
COMMENT ON COLUMN transit_staging.stops.location_type IS 'GTFS location_type; only empty or 0 (boarding stop) is promoted.';

COMMENT ON TABLE  transit_staging.trips IS 'Staging: trips.txt as loaded by COPY.';
COMMENT ON COLUMN transit_staging.trips.feed_version_id IS 'Feed version being imported.';
COMMENT ON COLUMN transit_staging.trips.trip_id IS 'GTFS trip_id.';
COMMENT ON COLUMN transit_staging.trips.route_id IS 'GTFS route_id.';
COMMENT ON COLUMN transit_staging.trips.service_id IS 'GTFS service_id.';
COMMENT ON COLUMN transit_staging.trips.trip_headsign IS 'GTFS trip_headsign.';
COMMENT ON COLUMN transit_staging.trips.direction_id IS 'GTFS direction_id.';

COMMENT ON TABLE  transit_staging.stop_times IS 'Staging: stop_times.txt as loaded by COPY.';
COMMENT ON COLUMN transit_staging.stop_times.feed_version_id IS 'Feed version being imported.';
COMMENT ON COLUMN transit_staging.stop_times.trip_id IS 'GTFS trip_id.';
COMMENT ON COLUMN transit_staging.stop_times.stop_sequence IS 'GTFS stop_sequence as text.';
COMMENT ON COLUMN transit_staging.stop_times.stop_id IS 'GTFS stop_id.';
COMMENT ON COLUMN transit_staging.stop_times.arrival_time IS 'GTFS arrival_time, HH:MM:SS (hours may exceed 23).';
COMMENT ON COLUMN transit_staging.stop_times.departure_time IS 'GTFS departure_time, HH:MM:SS (hours may exceed 23).';

COMMENT ON TABLE  transit_staging.calendar IS 'Staging: calendar.txt as loaded by COPY.';
COMMENT ON COLUMN transit_staging.calendar.feed_version_id IS 'Feed version being imported.';
COMMENT ON COLUMN transit_staging.calendar.service_id IS 'GTFS service_id.';
COMMENT ON COLUMN transit_staging.calendar.monday IS '1 = service runs on Mondays in the date range.';
COMMENT ON COLUMN transit_staging.calendar.tuesday IS '1 = service runs on Tuesdays in the date range.';
COMMENT ON COLUMN transit_staging.calendar.wednesday IS '1 = service runs on Wednesdays in the date range.';
COMMENT ON COLUMN transit_staging.calendar.thursday IS '1 = service runs on Thursdays in the date range.';
COMMENT ON COLUMN transit_staging.calendar.friday IS '1 = service runs on Fridays in the date range.';
COMMENT ON COLUMN transit_staging.calendar.saturday IS '1 = service runs on Saturdays in the date range.';
COMMENT ON COLUMN transit_staging.calendar.sunday IS '1 = service runs on Sundays in the date range.';
COMMENT ON COLUMN transit_staging.calendar.start_date IS 'GTFS start_date, YYYYMMDD.';
COMMENT ON COLUMN transit_staging.calendar.end_date IS 'GTFS end_date, YYYYMMDD (inclusive).';

COMMENT ON TABLE  transit_staging.calendar_dates IS 'Staging: calendar_dates.txt as loaded by COPY.';
COMMENT ON COLUMN transit_staging.calendar_dates.feed_version_id IS 'Feed version being imported.';
COMMENT ON COLUMN transit_staging.calendar_dates.service_id IS 'GTFS service_id.';
COMMENT ON COLUMN transit_staging.calendar_dates.date IS 'GTFS date, YYYYMMDD.';
COMMENT ON COLUMN transit_staging.calendar_dates.exception_type IS '1 = service added on the date, 2 = removed.';

-- routines
COMMENT ON PROCEDURE transit.rebuild_transfers(integer, integer) IS 'Rebuilds walking transfers between stops of one feed version that are at most p_max_m metres apart.';
COMMENT ON FUNCTION transit.tg_feed_version_status() IS 'Trigger: allows only legal feed status transitions and stamps activated_at / archived_at.';

-- Down Migration
COMMENT ON FUNCTION transit.tg_feed_version_status() IS NULL;
COMMENT ON PROCEDURE transit.rebuild_transfers(integer, integer) IS NULL;
COMMENT ON COLUMN transit_staging.calendar_dates.exception_type IS NULL;
COMMENT ON COLUMN transit_staging.calendar_dates.date IS NULL;
COMMENT ON COLUMN transit_staging.calendar_dates.service_id IS NULL;
COMMENT ON COLUMN transit_staging.calendar_dates.feed_version_id IS NULL;
COMMENT ON TABLE  transit_staging.calendar_dates IS NULL;
COMMENT ON COLUMN transit_staging.calendar.end_date IS NULL;
COMMENT ON COLUMN transit_staging.calendar.start_date IS NULL;
COMMENT ON COLUMN transit_staging.calendar.sunday IS NULL;
COMMENT ON COLUMN transit_staging.calendar.saturday IS NULL;
COMMENT ON COLUMN transit_staging.calendar.friday IS NULL;
COMMENT ON COLUMN transit_staging.calendar.thursday IS NULL;
COMMENT ON COLUMN transit_staging.calendar.wednesday IS NULL;
COMMENT ON COLUMN transit_staging.calendar.tuesday IS NULL;
COMMENT ON COLUMN transit_staging.calendar.monday IS NULL;
COMMENT ON COLUMN transit_staging.calendar.service_id IS NULL;
COMMENT ON COLUMN transit_staging.calendar.feed_version_id IS NULL;
COMMENT ON TABLE  transit_staging.calendar IS NULL;
COMMENT ON COLUMN transit_staging.stop_times.departure_time IS NULL;
COMMENT ON COLUMN transit_staging.stop_times.arrival_time IS NULL;
COMMENT ON COLUMN transit_staging.stop_times.stop_id IS NULL;
COMMENT ON COLUMN transit_staging.stop_times.stop_sequence IS NULL;
COMMENT ON COLUMN transit_staging.stop_times.trip_id IS NULL;
COMMENT ON COLUMN transit_staging.stop_times.feed_version_id IS NULL;
COMMENT ON TABLE  transit_staging.stop_times IS NULL;
COMMENT ON COLUMN transit_staging.trips.direction_id IS NULL;
COMMENT ON COLUMN transit_staging.trips.trip_headsign IS NULL;
COMMENT ON COLUMN transit_staging.trips.service_id IS NULL;
COMMENT ON COLUMN transit_staging.trips.route_id IS NULL;
COMMENT ON COLUMN transit_staging.trips.trip_id IS NULL;
COMMENT ON COLUMN transit_staging.trips.feed_version_id IS NULL;
COMMENT ON TABLE  transit_staging.trips IS NULL;
COMMENT ON COLUMN transit_staging.stops.location_type IS NULL;
COMMENT ON COLUMN transit_staging.stops.stop_lon IS NULL;
COMMENT ON COLUMN transit_staging.stops.stop_lat IS NULL;
COMMENT ON COLUMN transit_staging.stops.stop_name IS NULL;
COMMENT ON COLUMN transit_staging.stops.stop_id IS NULL;
COMMENT ON COLUMN transit_staging.stops.feed_version_id IS NULL;
COMMENT ON TABLE  transit_staging.stops IS NULL;
COMMENT ON COLUMN transit_staging.routes.route_type IS NULL;
COMMENT ON COLUMN transit_staging.routes.route_long_name IS NULL;
COMMENT ON COLUMN transit_staging.routes.route_short_name IS NULL;
COMMENT ON COLUMN transit_staging.routes.agency_id IS NULL;
COMMENT ON COLUMN transit_staging.routes.route_id IS NULL;
COMMENT ON COLUMN transit_staging.routes.feed_version_id IS NULL;
COMMENT ON TABLE  transit_staging.routes IS NULL;
COMMENT ON COLUMN transit_staging.agency.agency_timezone IS NULL;
COMMENT ON COLUMN transit_staging.agency.agency_name IS NULL;
COMMENT ON COLUMN transit_staging.agency.agency_id IS NULL;
COMMENT ON COLUMN transit_staging.agency.feed_version_id IS NULL;
COMMENT ON TABLE  transit_staging.agency IS NULL;
COMMENT ON COLUMN transit.outbox.published_at IS NULL;
COMMENT ON COLUMN transit.outbox.occurred_at IS NULL;
COMMENT ON COLUMN transit.outbox.payload IS NULL;
COMMENT ON COLUMN transit.outbox.event_type IS NULL;
COMMENT ON COLUMN transit.outbox.event_id IS NULL;
COMMENT ON TABLE  transit.outbox IS NULL;
COMMENT ON COLUMN transit.hex_stop_access.walk_s IS NULL;
COMMENT ON COLUMN transit.hex_stop_access.stop_id IS NULL;
COMMENT ON COLUMN transit.hex_stop_access.h3_index IS NULL;
COMMENT ON COLUMN transit.hex_stop_access.feed_version_id IS NULL;
COMMENT ON COLUMN transit.hex_cells.centroid IS NULL;
COMMENT ON COLUMN transit.hex_cells.city_id IS NULL;
COMMENT ON COLUMN transit.hex_cells.h3_index IS NULL;
COMMENT ON COLUMN transit.transfers.walk_s IS NULL;
COMMENT ON COLUMN transit.transfers.to_stop_id IS NULL;
COMMENT ON COLUMN transit.transfers.from_stop_id IS NULL;
COMMENT ON COLUMN transit.transfers.feed_version_id IS NULL;
COMMENT ON COLUMN transit.stop_times.departure_s IS NULL;
COMMENT ON COLUMN transit.stop_times.arrival_s IS NULL;
COMMENT ON COLUMN transit.stop_times.stop_id IS NULL;
COMMENT ON COLUMN transit.stop_times.stop_sequence IS NULL;
COMMENT ON COLUMN transit.stop_times.trip_id IS NULL;
COMMENT ON COLUMN transit.stop_times.feed_version_id IS NULL;
COMMENT ON TABLE  transit.stop_times IS NULL;
COMMENT ON COLUMN transit.trips.direction IS NULL;
COMMENT ON COLUMN transit.trips.headsign IS NULL;
COMMENT ON COLUMN transit.trips.gtfs_id IS NULL;
COMMENT ON COLUMN transit.trips.service_id IS NULL;
COMMENT ON COLUMN transit.trips.route_id IS NULL;
COMMENT ON COLUMN transit.trips.trip_id IS NULL;
COMMENT ON COLUMN transit.trips.feed_version_id IS NULL;
COMMENT ON TABLE  transit.trips IS NULL;
COMMENT ON COLUMN transit.service_dates.service_date IS NULL;
COMMENT ON COLUMN transit.service_dates.service_id IS NULL;
COMMENT ON COLUMN transit.service_dates.feed_version_id IS NULL;
COMMENT ON COLUMN transit.services.gtfs_id IS NULL;
COMMENT ON COLUMN transit.services.service_id IS NULL;
COMMENT ON COLUMN transit.services.feed_version_id IS NULL;
COMMENT ON TABLE  transit.services IS NULL;
COMMENT ON COLUMN transit.stops.geom IS NULL;
COMMENT ON COLUMN transit.stops.name IS NULL;
COMMENT ON COLUMN transit.stops.gtfs_id IS NULL;
COMMENT ON COLUMN transit.stops.stop_id IS NULL;
COMMENT ON COLUMN transit.stops.feed_version_id IS NULL;
COMMENT ON TABLE  transit.stops IS NULL;
COMMENT ON COLUMN transit.routes.route_type_id IS NULL;
COMMENT ON COLUMN transit.routes.long_name IS NULL;
COMMENT ON COLUMN transit.routes.short_name IS NULL;
COMMENT ON COLUMN transit.routes.gtfs_id IS NULL;
COMMENT ON COLUMN transit.routes.agency_id IS NULL;
COMMENT ON COLUMN transit.routes.route_id IS NULL;
COMMENT ON COLUMN transit.routes.feed_version_id IS NULL;
COMMENT ON TABLE  transit.routes IS NULL;
COMMENT ON COLUMN transit.agencies.name IS NULL;
COMMENT ON COLUMN transit.agencies.gtfs_id IS NULL;
COMMENT ON COLUMN transit.agencies.agency_id IS NULL;
COMMENT ON COLUMN transit.agencies.feed_version_id IS NULL;
COMMENT ON TABLE  transit.agencies IS NULL;
COMMENT ON COLUMN transit.feed_versions.error_message IS NULL;
COMMENT ON COLUMN transit.feed_versions.archived_at IS NULL;
COMMENT ON COLUMN transit.feed_versions.activated_at IS NULL;
COMMENT ON COLUMN transit.feed_versions.status IS NULL;
COMMENT ON COLUMN transit.feed_versions.valid_to IS NULL;
COMMENT ON COLUMN transit.feed_versions.valid_from IS NULL;
COMMENT ON COLUMN transit.feed_versions.fetched_at IS NULL;
COMMENT ON COLUMN transit.feed_versions.feed_source_id IS NULL;
COMMENT ON COLUMN transit.feed_versions.feed_version_id IS NULL;
COMMENT ON COLUMN transit.feed_sources.is_enabled IS NULL;
COMMENT ON COLUMN transit.feed_sources.license IS NULL;
COMMENT ON COLUMN transit.feed_sources.url IS NULL;
COMMENT ON COLUMN transit.feed_sources.name IS NULL;
COMMENT ON COLUMN transit.feed_sources.code IS NULL;
COMMENT ON COLUMN transit.feed_sources.city_id IS NULL;
COMMENT ON COLUMN transit.feed_sources.feed_source_id IS NULL;
COMMENT ON COLUMN transit.cities.is_enabled IS NULL;
COMMENT ON COLUMN transit.cities.h3_resolution IS NULL;
COMMENT ON COLUMN transit.cities.timezone IS NULL;
COMMENT ON COLUMN transit.cities.country_code IS NULL;
COMMENT ON COLUMN transit.cities.name IS NULL;
COMMENT ON COLUMN transit.cities.code IS NULL;
COMMENT ON COLUMN transit.cities.city_id IS NULL;
COMMENT ON COLUMN transit.route_types.name IS NULL;
COMMENT ON COLUMN transit.route_types.code IS NULL;
COMMENT ON COLUMN transit.route_types.route_type_id IS NULL;
COMMENT ON COLUMN transit.pgmigrations.run_on IS NULL;
COMMENT ON COLUMN transit.pgmigrations.name IS NULL;
COMMENT ON COLUMN transit.pgmigrations.id IS NULL;
COMMENT ON TABLE  transit.pgmigrations IS NULL;
