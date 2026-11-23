/// <reference lib="dom" />
// The map stays responsive while ~5 000 cells are prepared (docs/plan.md 8A.9). The CPU is slowed
// down four times (as Lighthouse does for mobile) and the basemap is empty. While the cells of a
// map are prepared and drawn, and again after zooming out (cells merged into parents), the page
// records its long tasks and the longest gap between two animation frames. The same run with the
// hexagon worker disabled (the hook then prepares on the main thread, as before 8A.9) is the
// baseline; results go to the test output and docs/evidence/frontend-performance.md.
// The DOM types are for the code that runs in the page (evaluate, init scripts).
import { expect, test, type Page } from '@playwright/test';
import { computeFrom, openWarsaw, register, uniqueEmail } from './support.ts';

interface Sample {
  longestTaskMs: number;
  blockingMs: number;
  longestFrameGapMs: number;
}

interface Recorder {
  tasks: number[];
  gaps: number[];
  reset(): void;
}

declare global {
  interface Window {
    __perf: Recorder;
  }
}

/** Records long tasks and frame gaps from page start; reset() starts a new phase. */
function recorder() {
  const perf: Recorder = {
    tasks: [],
    gaps: [],
    reset() {
      perf.tasks = [];
      perf.gaps = [];
    },
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) perf.tasks.push(entry.duration);
  }).observe({ type: 'longtask', buffered: false });
  let last = performance.now();
  const frame = (now: number) => {
    perf.gaps.push(now - last);
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__perf = perf;
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const { tasks, gaps } = window.__perf;
    return {
      longestTaskMs: Math.round(Math.max(0, ...tasks)),
      // Total blocking time as Lighthouse counts it: the part of each long task above 50 ms.
      blockingMs: Math.round(tasks.reduce((sum, t) => sum + Math.max(0, t - 50), 0)),
      longestFrameGapMs: Math.round(Math.max(0, ...gaps)),
    };
  });
}

interface Run {
  compute: Sample;
  zoomOut: Sample;
  /** Paths of the scripts the page and its workers requested. */
  scripts: string[];
}

async function measure(page: Page, withWorker: boolean): Promise<Run> {
  const scripts: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\.m?js$/.test(path)) scripts.push(path);
  });
  if (!withWorker) {
    // Only the hexagon worker fails to start (MapLibre keeps its own workers): the hook then
    // prepares the cells on the main thread.
    await page.addInitScript(() => {
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(url: string | URL, options?: WorkerOptions) {
          const broken = URL.createObjectURL(new Blob(['throw new Error("disabled")'], { type: 'text/javascript' }));
          super(String(url).includes('hexagons.worker') ? broken : url, options);
        }
      };
    });
  }
  await page.addInitScript(recorder);
  // An empty basemap (background only): tile loading and label rendering from the internet would
  // otherwise dominate the numbers, while this test measures the work on the result cells.
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef' } }],
      },
    }),
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await openWarsaw(page);
  const map = page.locator('.map');
  await expect(map).toHaveAttribute('data-cells', 'empty', { timeout: 30_000 });
  await page.evaluate(() => window.__perf.reset());
  await computeFrom(page, 'Central Station', /Central Station/);
  await expect(map).toHaveAttribute('data-cells', 'ready', { timeout: 60_000 });
  const compute = await sample(page);

  // Zoom out below 10: resolution 7, every cell merged into its parent.
  await page.evaluate(() => window.__perf.reset());
  const box = await map.boundingBox();
  if (box === null) throw new Error('no map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
  }
  await expect(map).toHaveAttribute('data-resolution', '7');
  await expect(map).toHaveAttribute('data-cells', 'ready', { timeout: 60_000 });
  const zoomOut = await sample(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { compute, zoomOut, scripts };
}

test.describe('map performance', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CPU throttling and long tasks need Chromium');

  test('cells are prepared off the main thread', async ({ browser }, info) => {
    test.setTimeout(240_000);
    const run = async (withWorker: boolean) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const result = await measure(await context.newPage(), withWorker);
      await context.close();
      return result;
    };
    const mainThread = await run(false);
    const worker = await run(true);
    const report = {
      cells: 5333,
      cpuSlowdown: 4,
      mainThread: { compute: mainThread.compute, zoomOut: mainThread.zoomOut },
      worker: { compute: worker.compute, zoomOut: worker.zoomOut },
    };
    await info.attach('map-performance.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    console.log(`map performance ${JSON.stringify(report)}`);

    // The timings are reported, not asserted: two noisy measurements of a few hundred
    // milliseconds would make the test flaky (medians over several runs are in the evidence).
    // What is asserted is where the H3 work runs. With the worker the page never loads the
    // main-thread fallback (hexagons-*.js) or h3-js; the baseline does, so the check can fail.
    const onMainThread = (list: string[]) => list.filter((path) => /\/(hexagons-|h3-js\.)[^/]*\.js$/.test(path));
    expect(worker.scripts.some((path) => path.includes('hexagons.worker'))).toBe(true);
    expect(onMainThread(worker.scripts)).toEqual([]);
    expect(onMainThread(mainThread.scripts).length).toBeGreaterThan(0);
  });

  test('sign-in and places do not load the map engine', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (['script', 'other'].includes(request.resourceType()) && /\.m?js$/.test(new URL(request.url()).pathname)) {
        scripts.push(new URL(request.url()).pathname);
      }
    });
    const mapEngine = (list: string[]) => list.filter((path) => /MapView|maplibre/.test(path));

    await page.goto('/sign-in');
    await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();
    expect(scripts.length).toBeGreaterThan(0);
    expect(mapEngine(scripts)).toEqual([]);

    await page.goto('/');
    await register(page, uniqueEmail('perf'), 'Perf');
    await expect(page.getByRole('link', { name: 'Places' })).toBeVisible(); // signed in
    scripts.length = 0;
    await page.goto('/places'); // a fresh load of the places route
    await expect(page.getByRole('heading', { name: /Saved places/ })).toBeVisible();
    expect(scripts.some((path) => path.includes('PlacesPage'))).toBe(true);
    expect(mapEngine(scripts)).toEqual([]);
  });
});
