// Rate limits at the gateway: one anonymous client sends more than the limit of the route group
// allows. The surplus is refused with 429 and Retry-After, and other routes keep working.
//   scripts/load.sh rate-limit
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

const API = 'http://gateway:8080/api/v1';
const allowed = new Counter('allowed');
const limited = new Counter('limited');
const REQUESTS = 30;
/** POST /calculations allows an anonymous client 6 requests per window (contracts/openapi). */
const LIMIT = 6;

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 429));

export const options = {
  scenarios: { burst: { executor: 'shared-iterations', vus: 1, iterations: 1 } },
  thresholds: {
    checks: ['rate==1'],
    allowed: [`count==${LIMIT}`],
    limited: [`count==${REQUESTS - LIMIT}`],
  },
};

/** Waits until the window in progress (if any) is over, so that the count starts at zero. */
export function setup() {
  const body = JSON.stringify({ cityCode: 'waw', origin: { lat: 52.2, lon: 21.0 }, time: '08:00' });
  const params = { headers: { 'content-type': 'application/json' }, timeout: '30s' };
  http.post(`${API}/calculations`, body, params); // computed before the burst
  const { headers } = http.post(`${API}/calculations`, body, params);
  return { body, params, waitS: Number(headers['Ratelimit-Reset'] || 60) };
}

export default function ({ body, params, waitS }) {
  sleep(waitS + 1);
  const answers = http.batch(Array.from({ length: REQUESTS }, () => ['POST', `${API}/calculations`, body, params]));
  for (const r of answers) {
    (r.status === 429 ? limited : allowed).add(1);
    check(r, {
      'served or 429 with Retry-After': (x) =>
        x.status === 200 || (x.status === 429 && Number(x.headers['Retry-After']) > 0),
    });
  }
  check(http.get(`${API}/cities`), { 'other routes still answer': (r) => r.status === 200 });
}
