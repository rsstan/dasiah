# 5. Algorithms and data pipeline

Offline part (per feed version, `transit-data`): steps 1 to 4.
Online part (per request, `accessibility`): steps 5 to 9.

## 1. GTFS import (`transit-data`)

1. Download the zip from `feed_sources.url` (timeout, retry). Compute SHA-256. If
   `(feed_source_id, sha256)` exists, stop: nothing new.
2. Store the zip in object storage under `raw/<source>/<sha256>.zip`; insert `feed_versions`
   (`downloaded`).
3. Stream each needed file (`agency`, `routes`, `stops`, `trips`, `stop_times`, `calendar`,
   `calendar_dates`) into its `transit_staging` table with `COPY ... FROM STDIN`, selecting
   only the staged columns by header name and adding `feed_version_id`. Missing optional files
   (`calendar` or `calendar_dates`) are fine. Strip the UTF-8 BOM. Set status `staged`.
4. In one transaction: `CALL transit.promote_feed(id)`, `CALL transit.rebuild_transfers(id)`,
   `CALL transit.rebuild_hex_stop_access(id)`. On error: roll back, set `failed` with the message.
5. Activation is a separate admin action (`CALL transit.activate_feed(id)`).

Checks done by `promote_feed`: every staged trip and stop_time lands in core (no unknown
references), at least one service date, typed conversion of times and coordinates. Extra checks
in the service before promotion: stops more than 1 500 m outside the city boundary and trips
with fewer than two stop_times are logged as warnings; the import fails when more than
`MAX_STOPS_OUTSIDE_SHARE` (25 %) of the stops are outside (wrong feed for the city).

Implementation (`services/transit-data/src/import/`): download with redirects, retries for
network errors and 5xx, timeout and size limit, SHA-256 computed while writing; a failed
attempt of the same archive is replaced, any other repeat is a no-op (`200`, `duplicate`).
Files are streamed from the zip (yauzl) through a CSV parser into `COPY ... FROM STDIN`; the
promotion transaction raises `statement_timeout` (`IMPORT_STATEMENT_TIMEOUT_MS`) and
`work_mem`. Versions left `downloaded`/`staged` by a restart are marked `failed` at start-up.
Timings per stage (`copy_ms`, `checks_ms`, `promote_ms`) and core row counts are logged in the
"feed validated" line. Outside the API: `pnpm transit:import --source <code> (--file <zip> |
--download) [--activate]`.

Notes:

- GTFS times may exceed `24:00:00`; they are stored as seconds from the start of the service day.
- Rows of `stops.txt` with `location_type` other than empty or 0 are stations or entrances and
  are skipped.
- Extended route types (100 to 1700; Vilnius uses 800 for trolleybuses) are in the reference data.
- `promote_feed` refreshes planner statistics (`transit.analyze_feed_tables()`) after staging and
  before the stop_times step, and the importer does again at the end: without them the planner
  misjudges freshly inserted rows (see `docs/evidence/import.md`).
- Check each publisher's page for the feed URL, update frequency and licence before the first
  import and record the licence in `feed_sources.license`.

## 2. Hexagon grid

Per city, once (and when bounds change): `polygonToCells(bounds, h3_resolution)` with h3-js,
insert into `transit.hex_cells` with `cellToLatLng` as centroid, and the boundary replaces the
seeded rectangle in `cities.bounds`. Boundaries: OSM relations 336075 (Warsaw) and 1529146
(Vilnius), fetched through Nominatim and simplified to 0.0003 degrees, stored in
`db/seed/reference/boundaries/*.geojson` (ODbL). Command: `pnpm transit:grid --city waw`.
Size at resolution 9: Warsaw 5 333 cells, Vilnius 4 339 (cells at these latitudes average
about 0.097 km2). The command also recomputes the access stops of the city's validated and
active feed versions; `mv_city_coverage` shows the new grid after the next activation (only the
view owner may refresh it, which `activate_feed` does).

## 3. Access stops and transfers (SQL procedures)

- `rebuild_hex_stop_access`: for every cell, up to 5 nearest stops within 1 500 m of the
  centroid, `walk_s = ceil(distance x 1.3 / 1.389)`.
- `rebuild_transfers`: stop pairs within 300 m, same formula, both directions.
- A cell with no row in `hex_stop_access` has no transit access.

The walking model (factor 1.3, 5 km/h) exists in two places that must match:
`transit.walk_seconds()` and `walkSeconds()` in `packages/common`.

## 4. Timetable artifact (`transit-data` -> `accessibility`)

`GET /internal/feed-versions/{id}/timetable?date=D` returns gzip JSON for the trips whose service
runs on `D`, plus trips of `D-1` that are still running after midnight (times of `D-1` minus
86 400).

```json
{ "version": 1, "feedVersionId": 12, "date": "2026-12-02",
  "stops": [ { "id": 17, "lat": 52.23, "lon": 21.01 } ],
  "transfers": [ [17, 18, 95] ],
  "patterns": [ { "routeId": 4, "stops": [17, 21, 30],
                  "trips": [ [28800, 28800, 29100, 29160, 29520, 29520] ] } ] }
```

A pattern is a group of trips of one route with exactly the same stop sequence. Each trip is a
flat array `[arr0, dep0, arr1, dep1, ...]`. Trips inside a pattern are sorted by departure at
the first stop; if two trips of a pattern overtake each other, split them into separate
patterns (RAPTOR requires non-overtaking trips). Built with one SQL query per date and cached
in storage by `(feedVersionId, date)` (`artifacts/<id>/timetable-<date>.json.gz`, strong `ETag`
from the content hash, `304` on `If-None-Match`, one build at a time per artifact). The query
aggregates each trip's stop times into arrays, so a city-size feed comes back as tens of
thousands of rows, not millions. It reads most of a feed's `stop_times`, so a sequential
scan is expected; the transaction sets `SET LOCAL work_mem = '64MB'` so the sort stays in memory
(`docs/db/query-plans.md`).

## 5. Origin

Snap the requested point to its H3 resolution-10 cell and use the cell centre as the origin.
This is the cache key and keeps exact addresses out of the database. Reject origins outside the
city bounds.

## 6. Transit times: RAPTOR (`accessibility`)

Loading (`services/accessibility/src/timetables/`): at start-up the active feed of every city in
`CITIES` and its hex access are fetched from transit-data; on `transit.feed.activated.v1` the new
snapshot is built completely, recorded in `feed_snapshots` (same transaction as the inbox row) and
then swapped in with one assignment; a failed load leaves the previous snapshot serving and the
message is retried. Readiness requires at least one loaded city.

In-memory structures per `(feedVersionId, date)`, typed arrays, built once and kept in an LRU:

- `patternStops`, `patternStopTimes` (flattened), offsets per pattern;
- `stopPatterns`: for each stop, the patterns serving it and the position in each;
- `transfers` adjacency per stop;
- a spatial grid over stops for "stops within radius".

Query (one-to-all, earliest arrival), departure time `τ`:

1. Access: stops within 1 000 m of the origin, `arr[s] = τ + walkSeconds(dist)`. Mark them.
2. Round `k = 1..K` (K = 5, at most 4 transfers):
   - collect patterns through marked stops, with the earliest marked position of each;
   - scan each collected pattern from that position: keep the current trip; at each stop, if
     the trip improves `arr[stop]`, update and mark; if `arrPrev[stop]` is earlier than the
     current trip's departure there, try to catch an earlier trip (binary search over trips
     by departure at this position; boarding requires `dep >= arrPrev[stop]`);
   - relax transfers from stops improved in this round (one hop, not chained);
   - stop when nothing was marked.
3. Output `arr[stop]` for every stop. Prune with a horizon of `τ + 7 200 s`.

Cell time for destination cell `c`:

```
transit(c) = min over access stops s of c ( arr[s] + walk_s(c, s) ) - τ
walk(c)    = walkSeconds(haversine(origin, centroid(c)))
t_transit(c) = min(transit(c), walk(c))          # walking wins for nearby cells
```

`t_transit` is `null` when it exceeds 7 200 s (class `unreachable`); cells without access stops
get `has_stop = false` (class `no_transit`) unless walking alone is within 1 800 s.

Departure window (`window_s > 0`): run the query for departures every 300 s inside the window
and store the median per cell. This removes the "just missed the bus" noise; default stays 0
until performance is measured.

Tests for RAPTOR are written against `fixtures/gtfs/testville` with hand-computed answers:
direct trip, one transfer at the same stop, transfer on foot, a faster trip that requires
waiting, trip past midnight, unreachable stop, origin next to the destination.

## 7. Car times: OSRM

- One OSRM instance per city (MLD pipeline: `osrm-extract` with the car profile,
  `osrm-partition`, `osrm-customize`) from a Geofabrik extract. Start `osrm-routed` with
  `--max-table-size` at least 1 001.
- Request `table/v1/driving/{origin};{destinations}?sources=0&annotations=duration` in chunks
  of at most 500 destinations (polyline-encoded coordinates keep the URL short), a few chunks in
  parallel, each behind timeout, retry and circuit breaker.
- Destinations are fixed per city (cell centroids), so the encoded chunks are prepared once.
- `car_s = round(duration x CAR_TIME_FACTOR) + CAR_OVERHEAD_S` (defaults 1.0 and 0). `null`
  from OSRM stays `null`. Durations below 60 s are raised to 60 s so the ratio is defined.
- If any chunk fails after retries the calculation fails; partial maps are not stored.

## 8. Ratio and class

Stored: `transit_s`, `car_s`, `has_stop`. Derived by `v_calculation_results`:
`ratio = round(transit_s / car_s, 2)` and the legend class from `ratio_classes`. Changing
thresholds, the walking model, K, the horizon or the car factors requires bumping `ALGO_VERSION`.

## 9. Caching and clean-up

- Cache key: `(feed_version_id, origin_h3, service_date, departure_s, window_s, algo_version)`.
- Flow: look up `done` row -> return. Otherwise insert a `running` row; a unique-violation
  means someone else is computing it -> `202`. The key is taken before waiting for a bulkhead
  slot (`MAX_PARALLEL_CALCS` running, `MAX_QUEUED_CALCS` waiting), so identical requests get
  `202` rather than `503`; a rejected request is marked `failed` (`busy`) and answered `503`.
  On success insert results, set `done` and write `accessibility.calculation.completed.v1` in
  one transaction; on failure set `failed` with `error_code` (`osrm_unavailable`,
  `timetable_unavailable`, `busy`, `internal_error`). A signed-in user's cache hit also writes the
  event (`cacheHit: true`) so the history records it.
- The computation starts from the centre of the origin's resolution-10 cell; RAPTOR and the OSRM
  table run concurrently.
- `expires_at` = now + 24 h. A timer calls `accessibility.purge_expired()` every 10 minutes. On
  start-up, `running` rows older than the request timeout are set to `failed`.

## 10. Map rendering (`web`)

- Cells arrive as H3 indexes; polygons are built in the browser with `cellsToMultiPolygon` /
  `cellToBoundary` and drawn as one MapLibre `fill` layer coloured by class.
- Zoom levels: below zoom 10 aggregate to resolution 7, 10 to 12 resolution 8, above 12
  resolution 9 (`cellToParent`, median ratio of children).
- Smoothed look: low fill outline, slight blur by opacity interpolation; a canvas-interpolated
  layer is an optional later improvement.
- Basemap: a free vector tile source with OSM attribution visible.
