# Testville: synthetic GTFS feed

A tiny, fully hand-checkable GTFS feed used by the import tests (`transit-data`), the RAPTOR unit
tests (`accessibility`), the test seed (`db/seed/test/`) and the end-to-end suite. It is entirely
fictional; the coordinates lie inside the Warsaw bounds so the feed can be loaded for city `waw`.

Agency `TT` (Testville Transit), time zone `Europe/Warsaw`. Validity 2026-11-01 to 2027-03-31.

## Network

```
             K Kiln ----- 4 ----> F Fern Hill            I Iron Works ---- 3 ----> J Junction
            (52.2090,21.0150)    (52.2090,21.0300)       (52.2105,21.0450)        (52.2105,21.0600)
               ^                  |  ^                      ^
               4                  |  |                      3
               |                  2  2                      |
               |                  v  |                      H Harbour (52.2015,21.0450)
  A Alpha ---- 1 ---> B Birch ---- 1 ---> C Central ---- 1 ---> D Dock ---- 1 ---> E East End
  (52.2000,21.0000)   (52.2000,21.0150) (52.2000,21.0300)   (52.2000,21.0450)  (52.2000,21.0600)
     \_______________________ 1X express: A -> C -> E (no stop at B, D) ______________/
                                          |  ^
                                          2  2              D <-- walk 167 m, 157 s --> H
                                          v  |
                                        G Grove (52.1910,21.0300)

  M Meadow (52.1850,21.0000): a stop with no trips.
  CS Central Station: a station row (location_type 1) at the position of C, parent of C.
```

Neighbouring stops on a line are about 1 km apart; only D and H are close enough (under 300 m)
for a walking transfer.

### Routes and trips

All trips run on service `WK` (Monday to Friday) unless noted. Minutes are offsets from the first
departure; `8/9` means arrival 8, departure 9.

| Route | Type | Stops (offset, min) | Trips (first departure) |
| --- | --- | --- | --- |
| `R1` "1" east | bus | A 0, B 4, C 8/9, D 13, E 17 | 08:00, 08:20, 08:40, 23:50 (past midnight); `WE`: 09:00, 10:00 |
| `R1` "1" east, slow | bus | A 0, B 6, C 12/13, D 25, E 30 | 08:15 (`R1_WK_0815_SLOW`, overtaken by the 08:20) |
| `R1` "1" west | bus | E 0, D 4, C 8/9, B 13, A 17 | 08:30 |
| `R1X` "1X" | bus | A 0, C 5, E 10 | 08:05 |
| `R2` "2" south | tram | F 0, C 5, G 10 | 08:05, 08:15, 08:25, 08:35 |
| `R2` "2" north | tram | G 0, C 5, F 10 | 08:00, 08:20 |
| `R3` "3" | bus | H 0, I 6, J 12 | 08:20, 08:50 |
| `R4` "4" circle | bus | B 0, K 4, F 8, C 12, B 16 | 08:10, 08:40 (empty `agency_id`, no `direction_id`) |

Calendar: `WK` Monday to Friday and `WE` Saturday and Sunday, 2026-11-01 to 2027-03-31.
Exception on Thursday 2026-12-24: `WK` removed, `WE` added (holiday runs the weekend timetable).

## Edge cases covered

| Case | Where |
| --- | --- |
| Trip past midnight (`24:03:00`) | `R1_WK_2350` reaches D at 24:03 and E at 24:07 |
| Calendar exception, removed and added day | `calendar_dates.txt`, 2026-12-24 |
| Station row that must be skipped | `CS` (`location_type` 1) |
| Stop with no trips | `M` |
| Walking transfer | D <-> H, 166.9 m, `walk_s` 157 |
| Circular route (first stop = last stop) | `R4`: B, K, F, C, B |
| Overtaking trips in one route (pattern split) | `R1_WK_0815_SLOW` is passed by `R1_WK_0820` between C and D |
| Route without `agency_id` (single-agency feed) | `R4` |
| UTF-8 BOM | `agency.txt` starts with a BOM |
| Extra columns, different column order | `stop_code`, `parent_station`, `route_color`, `pickup_type`, `wheelchair_accessible`; `trips.txt` starts with `route_id` |
| Optional file not used by the import | `feed_info.txt` |

## Expected import result

After `promote_feed`, `rebuild_transfers` and `rebuild_hex_stop_access`:

| Table | Rows |
| --- | --- |
| `agencies` | 1 |
| `routes` | 5 |
| `stops` | 12 (13 in staging, the station is skipped) |
| `services` | 2 |
| `service_dates` | 151 (one service per day; on 2026-12-24 `WE` instead of `WK`) |
| `trips` | 19 |
| `stop_times` | 77 |
| `transfers` | 2 (D -> H and H -> D, 157 s each) |

`feed_versions.valid_from` = 2026-11-01, `valid_to` = 2027-03-31.

Patterns for Wednesday 2026-12-02 (timetable artifact): R1 east is split into two patterns because
of the overtaking slow trip; R1 west, R1X, R2 south, R2 north, R3 and R4 are one pattern each.

## Expected earliest arrivals (stop to stop)

The origin is a stop, so the access walk is 0 s. Walking between D and H takes 157 s. Values
were computed by hand and cross-checked with an independent connection-scan implementation;
a missing stop is unreachable.

| # | Case | Date | From, departure | Expected arrivals |
| --- | --- | --- | --- | --- |
| 1 | Direct trip | Wed 2026-12-02 | A 08:00 | B 08:04, C 08:08, D 08:13 (bus 1, no transfer) |
| 2 | Faster trip that requires waiting | Wed 2026-12-02 | A 08:00 | E 08:15 (wait for 1X at 08:05; bus 1 at 08:00 arrives 08:17) |
| 3 | One transfer at the same stop | Wed 2026-12-02 | A 08:00 | G 08:15 (1 to C, tram 2 at 08:10); F 08:18 (1 to B, bus 4 at 08:10); K 08:14 |
| 4 | Transfer on foot | Wed 2026-12-02 | A 08:00 | H 08:15:37 (1 to D, walk); I 08:26, J 08:32 (bus 3 at 08:20) |
| 5 | Overtaking | Wed 2026-12-02 | A 08:14 | B 08:21, C 08:27 (slow trip); D 08:33, E 08:37 (08:20 trip); G 08:35; F 08:48; J 09:02 |
| 6 | Trip past midnight, same day | Wed 2026-12-02 | D 23:59 | E 24:07 (= 86 820 s); H 24:01:37 (walk) |
| 7 | Trip past midnight, from the previous day | Sat 2026-12-05 | D 00:00 | E 00:07 (Friday's 23:50 trip) |
| 8 | Calendar exception | Thu 2026-12-24 | A 08:00 | B 09:04, C 09:08, D 09:13, E 09:17 (weekend trip at 09:00); F, G, I, J, K unreachable |
| 9 | Weekend | Sat 2026-12-05 | A 08:00 | same as case 8 |
| 10 | Unreachable stop | any | any | M is never reached (no trips, no transfer) |

Cell-level rules (`docs/05-algorithms.md#6-transit-times-raptor-accessibility`):

- Origin next to the destination: for a destination cell whose centre is closer to the origin
  than any route through a stop, `t_transit = walk(c)`; transit through the origin's own stop
  can only tie with walking, never beat it.
- A cell whose centre is more than 1 500 m from every stop has no access stops: `has_stop = false`
  (class `no_transit`) unless walking alone takes at most 1 800 s.

Walking model: `walk_s = ceil(distance_m * 1.3 / 1.389)`. Distances computed by PostGIS
(`geography`, spheroid); a haversine implementation may differ by one second.
