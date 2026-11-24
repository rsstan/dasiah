// Behaviour of the services under load, measured inside the Compose network so that the gateway's
// rate limits (shown separately by rate-limit.js) do not get in the way.
//   scripts/load.sh capacity          the full run (about 2.5 minutes)
//   scripts/load.sh capacity smoke    a few seconds per scenario, for CI
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

const SMOKE = __ENV.SMOKE === '1';
const seconds = (full) => (SMOKE ? 3 : full);
const ACCESSIBILITY = 'http://accessibility:3003';
const PLACES = 'http://places:3004';
const IDENTITY = 'http://identity:3001';
const PASSWORD = 'load-test-password';
const JSON_HEADERS = { 'content-type': 'application/json' };

/** Uncached requests refused by the bulkhead: deliberate back-pressure, not an error. */
const refused = new Counter('calculations_refused');
const computed = new Counter('calculations_computed');

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 503));

const constant = (exec, vus, start, duration) => ({
  executor: 'constant-vus',
  exec,
  vus,
  startTime: `${start}s`,
  duration: `${duration}s`,
  gracefulStop: '60s',
});
const D = seconds(25);
const GAP = D + 5;
export const options = {
  scenarios: {
    cached: constant('cached', SMOKE ? 2 : 20, 0, D),
    results: constant('results', SMOKE ? 2 : 10, GAP, D),
    uncached: constant('uncached', SMOKE ? 1 : 4, 2 * GAP, D),
    overload: constant('overload', SMOKE ? 4 : 20, 3 * GAP, seconds(15)),
    geocode: constant('geocode', SMOKE ? 2 : 20, 4 * GAP, seconds(15)),
    sign_in: constant('signIn', SMOKE ? 1 : 5, 4 * GAP + seconds(15) + 5, seconds(15)),
  },
  // Behaviour only, so the result does not depend on the machine: every answer is a success or a
  // deliberate 503 with Retry-After, and the services recover. Latencies are reported, not judged.
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
  },
  summaryTrendStats: ['min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const calculate = (origin, time) =>
  http.post(`${ACCESSIBILITY}/calculations`, JSON.stringify({ cityCode: 'waw', origin, time }), {
    headers: JSON_HEADERS,
    timeout: '120s',
  });
/** A point of the testville grid; a minute of the day makes the request new. */
const randomOrigin = () => ({ lat: 52.19 + Math.random() * 0.02, lon: 21 + Math.random() * 0.06 });
const randomTime = () => {
  const two = (n) => String(Math.floor(n)).padStart(2, '0');
  return `${two(6 + Math.random() * 16)}:${two(Math.random() * 60)}`;
};

export function setup() {
  const first = calculate({ lat: 52.2, lon: 21.0 }, '08:00');
  check(first, { 'a map can be computed': (r) => r.status === 200 || r.status === 201 });
  const email = `load-${Date.now()}@example.com`;
  const registered = http.post(`${IDENTITY}/auth/register`, JSON.stringify({ email, password: PASSWORD }), {
    headers: JSON_HEADERS,
  });
  check(registered, { registered: (r) => r.status === 201 });
  http.get(`${PLACES}/geocode?city=waw&q=Central`);
  return { calculationId: first.json('calculationId'), email };
}

export function cached() {
  check(calculate({ lat: 52.2, lon: 21.0 }, '08:00'), { 'from the cache': (r) => r.status === 200 });
}

export function results({ calculationId }) {
  const res = http.get(`${ACCESSIBILITY}/calculations/${calculationId}/results`, {
    headers: { 'accept-encoding': 'gzip' },
  });
  check(res, { 'a whole map': (r) => r.status === 200 && r.json('cells.#') > 5_000 });
}

export function uncached() {
  const res = calculate(randomOrigin(), randomTime());
  (res.status === 503 ? refused : computed).add(1);
  check(res, { 'computed, cached or refused': (r) => [200, 201, 202, 503].includes(r.status) });
}

export function overload() {
  const res = calculate(randomOrigin(), randomTime());
  (res.status === 503 ? refused : computed).add(1);
  check(res, {
    'answered or refused with Retry-After': (r) =>
      [200, 201, 202].includes(r.status) || (r.status === 503 && Number(r.headers['Retry-After']) > 0),
  });
}

export function geocode() {
  check(http.get(`${PLACES}/geocode?city=waw&q=Central`), { 'address found': (r) => r.status === 200 });
}

export function signIn({ email }) {
  const res = http.post(`${IDENTITY}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: JSON_HEADERS,
  });
  check(res, { 'signed in': (r) => r.status === 200 });
}

export function teardown() {
  // After the overload the service answers normally again, without a restart.
  let last;
  for (let i = 0; i < 30; i++) {
    last = calculate({ lat: 52.2, lon: 21.0 }, '08:00');
    if (last.status === 200) {
      break;
    }
    sleep(2);
  }
  check(last, { recovered: (r) => r.status === 200 });
}
