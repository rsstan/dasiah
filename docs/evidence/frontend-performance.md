# Evidence: front-end performance

Plan step 8A.9 (direction 3: code splitting, Web Worker, memoisation, bundle analysis,
Lighthouse). Measured on 2026-11-24 against the production build served by the end-to-end stack
(`pnpm e2e:up`, Caddy with zstd/gzip and immutable caching of hashed assets).

## What was changed

| Change | Where | Effect |
| --- | --- | --- |
| Every page except home and 404 is its own lazy chunk (8A.8) | `apps/web/src/app/router.tsx` | A route loads only its page |
| MapLibre GL behind a lazy `MapView` | `apps/web/src/features/map/index.ts` | The map engine (297 kB gzip) loads only on a city map |
| h3-js off the start chunk: the history origin comes from the address; display helpers without H3 moved to `display.ts` | `features/map/MapState.tsx`, `features/map/display.ts` | Start chunk 149 → 85 kB gzip; on the map page H3 runs only in the worker |
| Hexagon polygons and zoom merging in a Web Worker, cached per resolution, stale answers dropped, main-thread fallback (also after a worker failure) | `features/map/hexagons.worker.ts`, `features/map/useHexagons.ts` | See [Responsiveness](#responsiveness-of-the-map) |
| Memoisation: `MapView` and `Legend` are `memo`, the map's `onPick` is a stable callback | `features/map/MapView.tsx`, `features/map/Legend.tsx`, `app/CityLayout.tsx` | The map does not re-render when only the panel changes (status, departure, address box) |
| No backdrop blur under the floating city buttons; only `transform` is animated (`will-change`) | `styles/index.css` | Home page on mobile: performance 63 → 100, total blocking time 2.7 s → 0 |

Not memoised on purpose: sorting and filtering of saved places (at most 20) and feed versions
(a handful) cost microseconds; `useMemo` there would only add code.

## Bundle analysis

`pnpm web:analyze` builds with `rollup-plugin-visualizer`; the treemap is
[frontend-bundle.html](frontend-bundle.html) (open it in a browser). Chunks (gzip):

| Chunk | Contents | Size | Loaded |
| --- | --- | --- | --- |
| `index` | React DOM, TanStack Query, router setup, layouts, home page | 85 kB | start |
| `ui` | React Router, component kit, Zustand | 35 kB | start |
| `logger` | React, logger | 4 kB | start |
| `SignInPage` · `PlacesPage` · `HistoryPage` · `AccountPage` · `AdminPage` · `MapPage` | one page each | 0.4 · 0.3 · 1.3 · 1.1 · 4.0 · 1.0 kB | with the route |
| `places`, `useMutation`, `useParam` | shared by the places, map and account pages | 2.4 · 1.0 · 0.4 kB | with those routes |
| `MapView` | MapLibre GL and the map component | 297 kB | city map |
| `maplibre-gl-worker`, `hexagons.worker` | MapLibre's worker; H3 and hexagon preparation | 520 kB, 206 kB (raw) | city map, in workers |
| `h3-js` | H3 for the history page (and the rare main-thread fallback) | 63 kB | history page |

JavaScript loaded by a first visit (gzip):

| Route | Before 8A.9 (after 8A.8) | Now |
| --- | --- | --- |
| `/` | 187 kB | 123 kB |
| `/sign-in` | 188 kB | 124 kB |
| `/places` | 192 kB | 128 kB |
| `/cities/:code` | 492 kB | 428 kB (+ workers) |

Before 8A.8 every page and MapLibre were in one start bundle. The e2e test
`tests/e2e/src/performance.spec.ts` ("sign-in and places do not load the map engine") records
every script a fresh load of `/sign-in` and `/places` requests and checks that none is
`MapView` or MapLibre.

## Responsiveness of the map

`tests/e2e/src/performance.spec.ts` ("cells are prepared off the main thread"): Chromium with the
CPU slowed down four times, an empty basemap (so that tiles from the internet do not blur the
numbers), a Warsaw map of 5 333 cells. The page records its long tasks and the gaps between
animation frames, first while the map is computed and drawn, then while zooming out (the cells are
merged into parents, resolution 7). Baseline: the same run with only the hexagon worker disabled,
so the hook prepares on the main thread as before 8A.9. Median (range) of nine runs:

| Phase | Measure | Main thread | Worker |
| --- | --- | --- | --- |
| Compute and draw | total blocking time | 380 ms (232–1 040) | 161 ms (117–406) |
| | longest task | 198 ms (145–367) | 125 ms (109–218) |
| | longest frame gap | 317 ms (250–517) | 200 ms (133–283) |
| Zoom out | total blocking time | 73 ms (43–146) | 9 ms (0–37) |
| | longest task | 103 ms (68–126) | 57 ms (0–87) |

What is left on the main thread while drawing is React rendering and MapLibre itself (it parses
the GeoJSON in its own worker, but uploads and draws on the main thread). Single runs overlap,
so the test reports the timings instead of comparing them (a comparison would be flaky). It
asserts where the H3 work runs: with the worker the page never loads the main-thread fallback
module or h3-js; in the baseline it does.

The test found a bug before it shipped: after a failed worker, a later job (a zoom change) was
sent to the dead worker and the map stayed in "preparing". A failed worker is now dropped and
every later job runs on the main thread (unit test in `useHexagons.test.tsx`).

## Lighthouse

`scripts/lighthouse.sh` (Lighthouse 13.6.0, Chrome 150): the home page, sign-in, and a Warsaw
map opened from a shared link (`/cities/waw?lat=52.2002&lon=21.0302`, which computes the map);
desktop preset and the default mobile profile (simulated slow 4G: 150 ms RTT, 1.6 Mbit/s;
CPU slowed down four times). The reports are written to `.lighthouse/` (not in Git).

Headless Chrome draws WebGL in software (SwiftShader) unless it is told to use the GPU. Real
phones and computers draw the map on their GPU, so the script uses the GPU by default (here an
Intel UHD 630); `LIGHTHOUSE_GPU=0` gives the software numbers, shown second.

With the GPU:

| Page | Form | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | desktop | 100 | 100 | 96 | 91 | 0.3 s | 0.3 s | 0 ms | 0 |
| sign-in | desktop | 100 | 96 | 96 | 91 | 0.3 s | 0.5 s | 0 ms | 0 |
| map | desktop | 99 | 95 | 96 | 91 | 0.2 s | 0.9 s | 40 ms | 0 |
| home | mobile | 100 | 100 | 96 | 91 | 0.9 s | 0.9 s | 0 ms | 0 |
| sign-in | mobile | 99 | 96 | 96 | 91 | 0.9 s | 2.0 s | 10 ms | 0 |
| map | mobile | 68 | 95 | 96 | 91 | 0.9 s | 4.4 s | 650 ms | 0 |

Software rendering (SwiftShader):

| Page | Form | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | desktop | 100 | 100 | 96 | 91 | 0.2 s | 0.2 s | 0 ms | 0 |
| sign-in | desktop | 100 | 96 | 96 | 91 | 0.2 s | 0.5 s | 0 ms | 0 |
| map | desktop | 67 | 95 | 96 | 91 | 0.2 s | 0.9 s | 1,010 ms | 0 |
| home | mobile | 100 | 100 | 96 | 91 | 0.9 s | 0.9 s | 10 ms | 0 |
| sign-in | mobile | 99 | 96 | 96 | 91 | 0.9 s | 2.0 s | 0 ms | 0 |
| map | mobile | 53 | 95 | 96 | 91 | 0.9 s | 4.4 s | 3,750 ms | 0 |

Before the changes of this step (software rendering, the first run): home mobile 63 (TBT
2.7 s, the blurred animated buttons), sign-in desktop 90, map desktop 57, map mobile 48.

**The map page on mobile stays below 90.** Its largest contentful paint is the status line
("5,333 cells · from cache"), which appears only after a chain of requests (page, cities,
calculation, results), while the 297 kB map engine shares the simulated 1.6 Mbit/s line and the
slowed CPU. The map is the content of this page, so its engine is not deferred to improve the
metric.

Decision of 2026-11-24: the step is closed with this exception. The Lighthouse target of 90 holds
for the home, sign-in and places pages on desktop and mobile and for the map page on desktop.
