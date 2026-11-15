# Evidence: import of real GTFS feeds

Plan step 5.5. Vilnius is done; Warsaw follows later (decision of 2026-11-15).

## Sources

Checked on 2026-11-15 against the Mobility Database catalog (`https://files.mobilitydatabase.org/feeds_v2.csv`).

| City | Source code | Catalog entry | URL | Licence | Size |
| --- | --- | --- | --- | --- | --- |
| Vilnius | `vno_vvt` | `mdb-1044`, Vilnius Transport, official, active | `https://www.stops.lt/vilnius/vilnius/gtfs.zip` | Not stated by the publisher or the catalog (to be confirmed before publication) | 3.4 MB, published 2026-11-13 |
| Warsaw | `waw_ztm` | `mdb-2092`, ZTM Warszawa, unofficial build by mkuran.pl, active | `https://mkuran.pl/gtfs/warsaw.zip` | CC0 1.0 | 102.6 MB, published 2026-11-14 |

The Vilnius URL in the reference data was wrong (`/vilnius/gtfs.zip` answers 404) and was
corrected. Both feeds have mirrors in the catalog (`https://files.mobilitydatabase.org/mdb-1044/latest.zip`,
`.../mdb-2092/latest.zip`).

## Vilnius

Command: `pnpm transit:import --source vno_vvt --download --activate` against the local Compose
database (PostgreSQL 16 in Docker on a developer laptop; disk I/O of the Docker volume is slow).

| Stage | Time | Result |
| --- | --- | --- |
| Download | 0.5 s | 3 372 550 bytes, SHA-256 `60abc912…de022419` |
| COPY into staging | 12.3 s | agency 1, routes 114, stops 1 544, trips 20 295, stop_times 407 698, calendar 219, calendar_dates 2 544 |
| Checks | 1.6 s | 52 of 1 544 stops more than 1.5 km outside the city boundary (suburban lines): warning, below the 25 % limit |
| Promotion, transfers, access stops (one transaction) | 27.5 s | see below |
| Whole command incl. activation | 43 s | status `active`, valid 2026-03-23 to 2027-11-01 |

Core and mart rows:

| Table | Rows |
| --- | --- |
| `agencies` | 1 |
| `routes` | 114 |
| `stops` | 1 544 |
| `trips` | 20 295 |
| `stop_times` | 407 698 |
| `service_dates` | 43 344 |
| `transfers` (stops within 300 m) | 3 556 |
| `hex_stop_access` (up to 5 stops within 1.5 km per cell) | 20 422 |

Coverage (`GET /cities/vno/coverage`): 4 339 grid cells, 4 204 of them (96.9 %) with a stop in
walking distance.

Timetable artifacts for accessibility, built right after the import:

| Date | Patterns | Trips | Of them from the previous day | JSON | gzip | Build | From cache |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Wed 2026-11-18 | 616 | 12 034 | 118 | 3.1 MB | 463 KB | 1.07 s | 2 ms |
| Sat 2026-11-21 | 599 | 8 555 | 129 | 2.2 MB | 327 KB | 0.73 s | — |

Hex access: 4 339 cells, 4.71 access stops per cell on average, 502 KB JSON, 0.12 s.

### Extended route types

The first attempt ended `failed` with nothing in the core tables:
`routes_route_type_id_fkey` — the feed uses the extended route type 800 (trolleybus) besides 3
(bus). The extended types of the Google Transit extension (100 to 1700) were added to
`db/seed/reference/transit.sql`, as `docs/05-algorithms.md` anticipated.

### Planner statistics (problem found and fixed)

Two symptoms on the real feed, invisible with the small test feed:

1. Right after the first import, the first timetable export hit the 300 s statement timeout; a
   few minutes later the same request took 0.5 s. Autovacuum had analysed the new rows in
   between.
2. After old Vilnius versions were deleted, the next promotion ran for more than 10 minutes
   (127 s the first time) and was cancelled. Autovacuum had recorded the core tables as nearly
   empty while their files stayed large, so rows inserted inside `promote_feed` were estimated
   at a few dozen and 400 000 staged stop times were joined with nested loops.

Fix (migration `transit-data/0004_import_statistics.sql`): `transit.analyze_feed_tables()`
(`SECURITY DEFINER`, because only the owner may `ANALYZE` in PostgreSQL 16) is called inside
`promote_feed` after staging and before the stop_times step, and by the importer after the
access stops are built. The cancelled run also showed the failure path on real data: status
`failed` with the reason, nothing in the core tables, staging emptied.

| Measure | Before | After |
| --- | --- | --- |
| Promotion after deleting old versions | > 650 s, cancelled | 27.5 s |
| First timetable export after an import | > 300 s (timeout) | 1.07 s |

## Warsaw

Not imported yet. The 102.6 MB archive includes the suburban lines of ZTM (bounding box 51.92
to 52.49 N), so the share of stops outside the city boundary has to be checked against the
25 % limit.
