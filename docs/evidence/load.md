# Evidence: load and rate limits

k6 2.3.0 against the end-to-end stack (testville as the Warsaw feed, 5 333 cells, OSRM and geocoder
stubs), inside the Compose network, 2026-11-24. One machine (8 threads) ran services, database and
k6. The scripts judge behaviour, not speed; latencies are information.

Full run (`pnpm load capacity`) with the database in memory, before the overload was reduced from 40
to 20 clients: 49 851 checks, 0 failed.

| Scenario | Clients | Median | p95 |
| --- | --- | --- | --- |
| Cached map | 20 | 23 ms | 37 ms |
| Results of a map (5 333 cells) | 10 | 174 ms | 245 ms |
| New map | 4 | 209 ms | 350 ms |
| Address search (cached) | 20 | 10 ms | 18 ms |
| Sign in (Argon2id) | 5 | 280 ms | 373 ms |
| Overload, new maps | 40 | 415 computed, 3 refused with 503 | recovered without a restart |

Rate limit (`pnpm load rate-limit`): 30 requests, 6 served, 24 refused with 429 and `Retry-After`; other
routes keep answering.

**What the load tests found.** With the database on the laptop's SSD the disk stalled
(I/O pressure above 70 %). That showed two defects, both fixed: a connection closed by PostgreSQL in
the middle of a transaction ended the service process, and a busy database gave 500. After the fix
the same situation gave only 200, 201 and 503, without a restart.
