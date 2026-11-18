import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import encoding from 'k6/encoding';

// Latency of a 304 versus a 200 for the same URLs at a low constant rate. Not a throughput test.
const E = __ENV;
const BASE = E.BASE;
const RATE = Number(E.RATE || 40);
const DUR = Number(E.DUR || 20);
const fx = new SharedArray('fixture', () => [JSON.parse(open(E.FIXTURE))])[0];
const cursor = (seq) => encoding.b64encode(`${fx.pub}:${seq}`, 'rawurl');
const URLS = {
  profile: `/v1/deputies/${fx.deputies[0].id}`,
  expenses_worst: `/v1/deputies/${fx.worst.id}/expenses?limit=100&cursor=${cursor(fx.worst.n - 101)}`,
  suppliers_list: '/v1/suppliers?limit=100',
};
const EPS = Object.keys(URLS);

const th = { dropped_iterations: ['count==0'] };
const scenarios = {};
['200', '304'].forEach((kind, i) => {
  scenarios[`k${kind}`] = {
    executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: `${DUR}s`,
    startTime: `${i * (DUR + 3)}s`, preAllocatedVUs: 20, maxVUs: 100, env: { KIND: kind },
  };
  for (const ep of EPS) th[`http_req_duration{ep:${ep},kind:${kind}}`] = ['max>=0'];
});
export const options = { scenarios, thresholds: th, summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'] };

export function setup() {
  const tags = {};
  for (const ep of EPS) {
    const r = http.get(BASE + URLS[ep]);
    if (r.status !== 200 || !r.headers['Etag']) throw new Error(`setup ${ep}: ${r.status}`);
    tags[ep] = r.headers['Etag'];
  }
  return tags;
}

export default function (tags) {
  const kind = __ENV.KIND;
  const ep = EPS[__ITER % EPS.length];
  const headers = kind === '304' ? { 'If-None-Match': tags[ep] } : {};
  const want = Number(kind);
  const res = http.get(BASE + URLS[ep], { headers, tags: { ep, kind }, responseCallback: http.expectedStatuses(want) });
  check(res, { 'status as expected': (x) => x.status === want });
}

export function handleSummary(data) {
  const m = data.metrics;
  const out = { rate: RATE, durationS: DUR, dropped: m.dropped_iterations ? m.dropped_iterations.values.count : 0, byEndpoint: {} };
  for (const kind of ['200', '304']) {
    for (const ep of EPS) {
      const v = m[`http_req_duration{ep:${ep},kind:${kind}}`];
      if (v) (out.byEndpoint[ep] = out.byEndpoint[ep] || {})[kind] = { p50: v.values.med, p95: v.values['p(95)'], p99: v.values['p(99)'], min: v.values.min, max: v.values.max };
    }
  }
  return { [E.OUT]: JSON.stringify(out, null, 1) + '\n' };
}
