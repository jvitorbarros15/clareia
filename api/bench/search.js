import http from 'k6/http';
import { check } from 'k6';

const terms = JSON.parse(open('./terms.json'));
const BASE = __ENV.BASE;
let i = 0;

export const options = {
  discardResponseBodies: true,
  scenarios: {
    search: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 50), timeUnit: '1s', duration: __ENV.DUR || '60s', preAllocatedVUs: 50, maxVUs: 200 },
  },
};

export default function () {
  const t = terms[i++ % terms.length];
  const res = http.get(`${BASE}/v1/suppliers?limit=50&q=${encodeURIComponent(t)}`);
  check(res, { '200': (r) => r.status === 200 });
}
