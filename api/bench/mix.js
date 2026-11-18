import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import encoding from 'k6/encoding';

// Assumed mix (the site is not launched, there is no real traffic): 60% deputy profile, 25% expense pages,
// 10% suppliers (half list, half detail), 5% meta. Ids come from a seeded PRNG keyed by the global iteration number.
const E = __ENV;
const BASE = E.BASE;
const TARGET = E.TARGET || 'api';
const RATE = Number(E.RATE || 100);
const DURATION = E.DURATION || '30s';
const SEED = Number(E.SEED || 20261118);
const fx = new SharedArray('fixture', () => [JSON.parse(open(E.FIXTURE))])[0];
const EPS = ['profile', 'expenses', 'expenses_worst', 'suppliers_list', 'suppliers_search', 'supplier_detail', 'meta'];

const th = {
  http_req_failed: ['rate<0.001'],
  checks: ['rate>0.999'],
  dropped_iterations: ['count==0'],
  http_req_duration: ['p(99)<1000'],
};
for (const ep of EPS) th[`http_req_duration{ep:${ep}}`] = ['max>=0'];

export const options = {
  scenarios: {
    mix: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.min(400, Math.max(50, Math.ceil(RATE / 5))),
      maxVUs: 3000,
    },
  },
  thresholds: th,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

function rng(n) {
  let a = (SEED + Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const skew = (arr, u) => arr[Math.floor(arr.length * u * u)];
const b64 = (s) => encoding.b64encode(s, 'rawurl');
const cursor = (seq) => b64(`${fx.pub}:${seq}`);

function pick(r) {
  const p = r();
  if (p < 0.6) {
    const missing = r() < 0.02;
    const d = skew(fx.deputies, r());
    if (TARGET === 'static') return { ep: 'profile', url: missing ? '/nao-existe.json' : '/summary.json', ok: missing ? 404 : 200 };
    return { ep: 'profile', url: `/v1/deputies/${missing ? 9999999 : d.id}`, ok: missing ? 404 : 200 };
  }
  if (p < 0.85) {
    const q = r();
    if (q < 0.05) {
      const w = fx.worst;
      if (TARGET === 'static') return { ep: 'expenses_worst', url: `/deputados/${w.id}/despesas.json`, ok: 200 };
      return { ep: 'expenses_worst', url: `/v1/deputies/${w.id}/expenses?limit=100&cursor=${cursor(w.n - 101)}`, ok: 200 };
    }
    const d = skew(fx.deputies, r());
    if (TARGET === 'static') return { ep: 'expenses', url: `/deputados/${d.id}/despesas.json`, ok: d.n > 0 ? 200 : 404 };
    const c = q < 0.3 && d.n > 100 ? `&cursor=${cursor(Math.floor(r() * (d.n - 100)))}` : '';
    return { ep: 'expenses', url: `/v1/deputies/${d.id}/expenses?limit=100${c}`, ok: 200 };
  }
  if (p < 0.95) {
    if (r() < 0.5) {
      if (TARGET === 'static') return { ep: 'suppliers_list', url: '/fornecedores.json', ok: 200 };
      const k = r();
      if (k < 0.4) {
        const t = fx.terms[Math.floor(r() * fx.terms.length)];
        return { ep: 'suppliers_search', url: `/v1/suppliers?limit=50&q=${encodeURIComponent(t)}`, ok: 200 };
      }
      const c = k < 0.7 ? '' : `&cursor=${b64(`${fx.pub}:${fx.labels[Math.floor(r() * fx.labels.length)]}`)}`;
      return { ep: 'suppliers_list', url: `/v1/suppliers?limit=100${c}`, ok: 200 };
    }
    const missing = r() < 0.05;
    const key = skew(fx.keys, r());
    if (TARGET === 'static') return { ep: 'supplier_detail', url: missing ? '/nao-existe.json' : '/fornecedores.json', ok: missing ? 404 : 200 };
    return { ep: 'supplier_detail', url: `/v1/suppliers/${missing ? '0'.repeat(64) : key}`, ok: missing ? 404 : 200 };
  }
  return { ep: 'meta', url: TARGET === 'static' ? '/index.json' : '/v1/meta', ok: 200 };
}

export default function () {
  const r = rng(exec.scenario.iterationInTest);
  const q = pick(r);
  const res = http.get(BASE + q.url, {
    tags: { ep: q.ep, name: q.ep },
    responseCallback: http.expectedStatuses(q.ok),
  });
  check(res, { 'status as expected': (x) => x.status === q.ok });
}

export function handleSummary(data) {
  const m = data.metrics;
  const d = (k) => (m[k] ? m[k].values : null);
  const lat = (v) => v && { p50: v.med, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'], min: v.min, max: v.max, avg: v.avg };
  const out = {
    target: TARGET, rate: RATE, duration: DURATION, seed: SEED,
    reqs: d('http_reqs').count, rps: d('http_reqs').rate,
    dropped: d('dropped_iterations') ? d('dropped_iterations').count : 0,
    failedRate: d('http_req_failed').rate,
    checksRate: d('checks').rate,
    kbPerReq: d('data_received').count / d('http_reqs').count / 1024,
    maxVUs: d('vus_max').max,
    latencyMs: lat(d('http_req_duration')),
    byEndpoint: {},
  };
  for (const ep of EPS) {
    const v = d(`http_req_duration{ep:${ep}}`);
    if (v) out.byEndpoint[ep] = lat(v);
  }
  return { [E.OUT]: JSON.stringify(out, null, 1) + '\n' };
}
