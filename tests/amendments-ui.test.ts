import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import * as ClareiaView from '../src/view.ts';

const DATA_JS = await fs.readFile(path.join(import.meta.dirname, '..', 'real', 'data.js'), 'utf8');
const APP_JS = await fs.readFile(path.join(import.meta.dirname, '..', 'real', 'app.js'), 'utf8');
const PORTAL_JS = await fs.readFile(path.join(import.meta.dirname, '..', 'real', 'portal.js'), 'utf8');
const PAGES_JS = await fs.readFile(path.join(import.meta.dirname, '..', 'real', 'pages.js'), 'utf8');

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r)); };

type AppFetch = (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

function bootAppJs(opts: {
  search?: string;
  senators?: boolean;
  includeAmendmentsUrls?: boolean;
  fetchImpl?: AppFetch;
  portal?: boolean;
} = {}) {
  const origin = 'https://clareia.test';
  const loc = { origin, pathname: '/', search: opts.search ?? '', href: '', assign(input: URL) { setUrl(input); } };
  const setUrl = (input: string | URL) => { const u = new URL(String(input), origin); loc.pathname = u.pathname; loc.search = u.search; loc.href = u.href; };
  setUrl('/' + (opts.search ?? ''));
  const year = new URLSearchParams(loc.search).get('ano') ?? '2025';
  const historyStack: { state: unknown; href: string }[] = [{ state: null, href: loc.href }];
  let historyIdx = 0;
  const winListeners = new Map<string, { fn: (ev?: unknown) => void; once?: boolean }[]>();
  const docListeners = new Map<string, ((ev: unknown) => void)[]>();
  const fireWin = (type: string) => {
    const list = winListeners.get(type) ?? [];
    winListeners.set(type, list.filter(x => !x.once));
    for (const item of list) item.fn();
  };
  const history = {
    get state() { return historyStack[historyIdx]?.state ?? null; },
    replaceState(st: unknown, _t: string, url?: string | URL | null) { if (url != null) setUrl(url); historyStack[historyIdx] = { state: st, href: loc.href }; },
    pushState(st: unknown, _t: string, url?: string | URL | null) { if (url != null) setUrl(url); historyStack.length = historyIdx + 1; historyStack.push({ state: st, href: loc.href }); historyIdx = historyStack.length - 1; },
    go(delta: number) { historyIdx = Math.max(0, Math.min(historyStack.length - 1, historyIdx + delta)); setUrl(historyStack[historyIdx].href); queueMicrotask(() => fireWin('popstate')); },
    back() { history.go(-1); },
  };
  const dialogListeners = new Map<string, (() => void)[]>();
  const dialog = {
    open: false,
    scrollTop: 0,
    classList: { remove() {}, add() {} },
    showModal() { this.open = true; },
    close() { if (!this.open) return; this.open = false; for (const fn of dialogListeners.get('close') ?? []) fn(); },
    contains() { return false; },
    addEventListener(type: string, fn: () => void) { const list = dialogListeners.get(type) ?? []; list.push(fn); dialogListeners.set(type, list); },
  };
  const makeBox = () => ({
    id: '', className: '', innerHTML: '', textContent: '', hidden: false, value: '', href: '', download: '',
    attrs: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    setAttribute(k: string, v: string) { this.attrs[k] = String(v); },
    focus(_opts?: unknown) {},
    scrollIntoView(_opts?: unknown) {},
    before() {},
    click() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40 }; },
  });
  type MockBox = ReturnType<typeof makeBox>;
  const bodyEl = makeBox();

  let detailHtml = '';
  let profileAmendmentsEl: MockBox | null = null;
  let scrolledToAmendments = false;
  const syncProfileAmendments = (html: string) => {
    const m = /<section\b[^>]*id="profile-amendments"[^>]*data-amendments-run="(\d+)"[^>]*>([\s\S]*?)<\/section>/.exec(html);
    if (!m) { profileAmendmentsEl = null; return; }
    let inner = m[2];
    const box = makeBox();
    box.id = 'profile-amendments';
    box.dataset = { amendmentsRun: m[1] };
    box.scrollIntoView = () => { scrolledToAmendments = true; };
    Object.defineProperty(box, 'innerHTML', {
      get() { return inner; },
      set(v: string) {
        inner = v;
        detailHtml = detailHtml.replace(
          /(<section\b[^>]*id="profile-amendments"[^>]*>)[\s\S]*?(<\/section>)/,
          (_m: string, open: string, close: string) => `${open}${v}${close}`,
        );
      },
      enumerable: true,
      configurable: true,
    });
    profileAmendmentsEl = box;
  };
  const detailBody = makeBox();
  Object.defineProperty(detailBody, 'innerHTML', {
    get() { return detailHtml; },
    set(v: string) { detailHtml = v; syncProfileAmendments(v); },
    enumerable: true,
    configurable: true,
  });

  const elements: Record<string, MockBox> = {
    '#app': makeBox(), '#universo': makeBox(), '#answer-slot': makeBox(), '#rank-slot': makeBox(),
    '#editorial-feature': makeBox(), '#hero-portrait': makeBox(), '#query': makeBox(), '#suggestions': makeBox(),
    '.search-wrap': makeBox(), '.editorial-search-examples': makeBox(), '.header-search': makeBox(),
    '#detail-title': makeBox(), '#detail-body': detailBody, '#detail .close-button': makeBox(), '#toast': makeBox(), '.footer': makeBox(),
  };

  let scopeChip: MockBox | null = null;
  const blobs = new Map<string, string>();
  const downloads: { filename: string; text: string }[] = [];
  let blobSeq = 0;

  class MockBlob {
    text: string;
    constructor(parts: string[]) { this.text = parts.join(''); }
  }
  const MockURL = new Proxy(URL, {
    get(target, prop, receiver) {
      if (prop === 'createObjectURL') return (b: MockBlob) => { const id = `blob:test-${++blobSeq}`; blobs.set(id, b.text); return id; };
      if (prop === 'revokeObjectURL') return (id: string) => { blobs.delete(id); };
      return Reflect.get(target, prop, receiver);
    },
  });

  const people = [
    { id: '1', officialId: 1, name: 'Ana Souza', photo: null, sourceUrl: '', social: [], uf: 'SP', ufNote: null, party: 'PL', partyNote: null, partyInReview: false, lastConfirmedParty: null, profileFetchedAt: '2025-03-01T00:00:00Z', months: 1, exercisedMonths: 1, noExercise: false, heldMonths: [], exerciseReviewMonths: [], comparable: true, use: { status: 'unconfirmed', counted: [], excluded: [], outside: [], missing: [1] }, projects: null, approved: null, votes: null, cells: [{ month: 0, category: 'TEST', supplier: 'EMPRESA LTDA', amount: 50000, count: 1 }], total: 50000 },
    { id: '2', officialId: 2, name: 'Bruno Lima', photo: null, sourceUrl: '', social: [], uf: 'RJ', ufNote: null, party: 'PT', partyNote: null, partyInReview: false, lastConfirmedParty: null, profileFetchedAt: '2025-03-01T00:00:00Z', months: 1, exercisedMonths: 1, noExercise: false, heldMonths: [], exerciseReviewMonths: [], comparable: true, use: { status: 'unconfirmed', counted: [], excluded: [], outside: [], missing: [1] }, projects: null, approved: null, votes: null, cells: [{ month: 0, category: 'TEST', supplier: 'EMPRESA LTDA', amount: 20000, count: 1 }], total: 20000 },
    { id: '3', officialId: 3, name: 'Carla Dias', photo: null, sourceUrl: '', social: [], uf: 'SP', ufNote: null, party: 'MDB', partyNote: null, partyInReview: false, lastConfirmedParty: null, profileFetchedAt: '2025-03-01T00:00:00Z', months: 1, exercisedMonths: 1, noExercise: false, heldMonths: [], exerciseReviewMonths: [], comparable: true, use: { status: 'unconfirmed', counted: [], excluded: [], outside: [], missing: [1] }, projects: null, approved: null, votes: null, cells: [{ month: 0, category: 'TEST', supplier: 'EMPRESA LTDA', amount: 10000, count: 1 }], total: 10000 },
  ];

  const includeUrls = opts.includeAmendmentsUrls !== false;
  const clareiaData: Record<string, unknown> = {
    minMonths: 1, ceiling: null, coverageApproved: false, billsApproved: false, votesApproved: false, billsYears: [], votesYears: [],
    label: (c: string) => c, dataset: () => people, categories: ['TEST'],
    monthNames: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    index: { snapshotId: 'snap1234567890', collectedAt: '2025-03-01T00:00:00Z', publishedAt: '2025-03-01T00:00:00Z', scope: { year: 2025, months: [1], ids: [1, 2, 3] }, validation: { sourceKind: 'annual', limitations: [] } },
    base: '/data/pub1', sharedBase: '/data/pub1', year, defaultYear: '2025', years: [{ year: 2025, months: [1], partial: true }, { year: 2024, months: [1], partial: false }],
    partial: true, partialLabel: 'parcial · jan 2025', provisional: [], provisionalNote: '', ceilingPending: false, shareImages: false,
    senators: opts.senators ?? true, yearBase: () => '/data/pub1', coverage: [0],
    suppliersLoaded: () => true, loadSuppliers: () => Promise.resolve(),
    ...(includeUrls ? {
      amendmentsUrl: (id: number | string) => `/data/pub1/emendas/${id}.json`,
      amendmentsIndexUrl: () => '/data/pub1/emendas/index.json',
    } : {}),
  };

  const win: Record<string, unknown> = {
    ClareiaData: clareiaData,
    addEventListener(type: string, fn: (ev?: unknown) => void, options?: { once?: boolean }) {
      const list = winListeners.get(type) ?? []; list.push({ fn, once: options?.once }); winListeners.set(type, list);
    },
  };
  win.window = win;

  const doc = {
    title: 'Clareia — o poder, em números',
    body: bodyEl,
    activeElement: bodyEl,
    createElement(tag?: string) {
      const box = makeBox();
      if (tag === 'div') scopeChip = box;
      if (tag === 'a') box.click = () => { downloads.push({ filename: box.download, text: blobs.get(box.href) ?? '' }); };
      return box;
    },
    querySelector(sel: string) {
      if (sel === '#detail') return dialog;
      if (sel === '#scope-chip') return scopeChip;
      if (sel === '#profile-amendments') return profileAmendmentsEl;
      return elements[sel] ?? null;
    },
    querySelectorAll() { return []; },
    addEventListener(type: string, fn: (ev: unknown) => void) {
      const list = docListeners.get(type) ?? []; list.push(fn); docListeners.set(type, list);
    },
    dispatchEvent(event: { type: string }) { for (const fn of docListeners.get(event.type) ?? []) fn(event); },
  };
  class CustomEvent { type: string; constructor(type: string) { this.type = type; } }
  const unrefTimeout = (fn: () => void, ms?: number) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };

  const requests: string[] = [];
  const fetchWrap: AppFetch = async url => {
    requests.push(url);
    if (opts.fetchImpl) return opts.fetchImpl(url);
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const sandbox: Record<string, unknown> = {
    window: win, document: doc, location: loc, history, ClareiaView, URL: MockURL, Blob: MockBlob, URLSearchParams, CustomEvent,
    matchMedia: () => ({ matches: true, addEventListener() {} }), setTimeout: unrefTimeout, clearTimeout,
    fetch: fetchWrap,
  };
  vm.runInNewContext(APP_JS, sandbox);
  if (opts.portal) vm.runInNewContext(PORTAL_JS, { ...sandbox, ResizeObserver: class {}, addEventListener: win.addEventListener });

  const clickTab = (tab: string) => {
    const target = { tagName: 'BUTTON', dataset: { tab }, closest(sel: string) { return sel.includes('[data-tab]') ? target : null; } };
    for (const fn of docListeners.get('click') ?? []) fn({ target, preventDefault() {} });
  };
  const clickHouse = (house: 'camara' | 'senado') => {
    const target = { tagName: 'BUTTON', dataset: { house }, closest(sel: string) { return sel.includes('[data-house]') ? target : null; } };
    for (const fn of docListeners.get('click') ?? []) fn({ target, preventDefault() {} });
  };
  const clickAction = (action: string, id?: string, kind?: string) => {
    const target = { tagName: 'BUTTON', dataset: { action, id, kind }, closest(sel: string) { return sel.includes('[data-action]') ? target : null; } };
    for (const fn of docListeners.get('click') ?? []) fn({ target, preventDefault() {} });
  };

  return {
    clareia: win.Clareia as {
      state: { house: string; tab: string; uf: string; year: string };
      profile: (id: string) => void;
      evidence: (id: string, opts?: { kind?: string }) => void;
      closeDialog: () => Promise<void>;
      refresh: () => void;
    },
    dialog, elements, requests, downloads, location: loc,
    clickTab, clickHouse, clickAction,
    scrolledToAmendments: () => scrolledToAmendments,
    amendmentsHtml: () => profileAmendmentsEl?.innerHTML ?? '',
  };
}

const SAMPLE_INDEX = {
  schema: 'clareia.amendments-index.v1',
  publicationId: 'am-pub-1',
  deputies: [
    { deputyId: 1, years: { '2024': 120000, '2025': 100000 } },
    { deputyId: 3, years: { '2025': 250000 } },
  ],
};

const SAMPLE_DEPUTY_1 = {
  schema: 'clareia.amendments-deputy.v1',
  publicationId: 'am-pub-1',
  deputyId: 1,
  rows: [
    { year: 2024, destination: 'Nacional', rows: 1, committed: 200000, liquidated: 150000, paid: 120000, carriedOver: 30000, carriedCancelled: 4000, carriedPaid: 6000 },
    { year: 2025, destination: 'BA', rows: 1, committed: 50000, liquidated: 40000, paid: 30000, carriedOver: 5000, carriedCancelled: 1000, carriedPaid: 500 },
    { year: 2025, destination: '<b>x</b>', rows: 1, committed: 50000, liquidated: 40000, paid: 30000, carriedOver: 2000, carriedCancelled: 0, carriedPaid: 0 },
    { year: 2025, destination: 'MÚLTIPLO', rows: 2, committed: 100000, liquidated: 80000, paid: 40000, carriedOver: 10000, carriedCancelled: 2000, carriedPaid: 3000 },
  ],
};

test('real/data.js exposes amendmentsUrl and amendmentsIndexUrl next to activityUrl', async () => {
  const responses: Record<string, unknown> = {
    '/manifest.json': { base: 'data/pub1', defaultYear: 2025, years: [{ year: 2025, months: [1], partial: true }] },
    '/data/pub1/index.json': { scope: { year: 2025, months: [1], ids: [1] }, validation: { heldMonths: {} }, people: [{ id: 1, name: 'Ana Souza', photo: null, sourceUrl: '', uf: 'SP', profileFetchedAt: '2025-03-01T00:00:00Z' }], collectedAt: '2025-03-01T00:00:00Z', snapshotId: 'snap1234567890' },
    '/data/pub1/summary.json': { publicationId: 'pub1', minMonths: 1, ceiling: null, coverageId: null, billsId: null, votesId: null, categories: ['TEST'], people: [{ id: 1, cents: 100, categories: [{ category: 'TEST', cents: 100, records: 1 }], party: 'PL', partyNote: null, partyInReview: false, lastConfirmedParty: null, exercisedMonths: 1, noExercise: false, heldMonths: [], exerciseReviewMonths: [], comparable: true, months: [{ month: 1, cents: 100, records: 1, held: false, exercise: 'full', ufStatus: 'single', uf: 'SP' }], bills: null }] },
  };
  let done!: () => void;
  const finished = new Promise<void>(r => { done = r; });
  const win: Record<string, unknown> = {};
  win.window = win;
  vm.runInNewContext(DATA_JS, {
    window: win, ClareiaView, URLSearchParams, location: { search: '', pathname: '/', hash: '' }, setTimeout,
    fetch: async (url: string) => Object.hasOwn(responses, url) ? { ok: true, json: async () => responses[url] } : { ok: false, status: 404, json: async () => ({}) },
    document: {
      getElementById: (id: string) => id === 'main' ? { append() {} } : { innerHTML: '' },
      createElement: () => ({ className: '', innerHTML: '', src: '', onload: null as (() => void) | null, onerror: null as (() => void) | null, setAttribute() {}, remove() {} }),
      body: { prepend() {}, appendChild(el: { src?: string; onload?: (() => void) | null }) { queueMicrotask(() => { el.onload?.(); if (el.src === '/portal.js') done(); }); } },
    },
  });
  await finished;
  const data = win.ClareiaData as { amendmentsUrl: (id: number) => string; amendmentsIndexUrl: () => string };
  assert.equal(data.amendmentsUrl(123), '/data/pub1/emendas/123.json');
  assert.equal(data.amendmentsIndexUrl(), '/data/pub1/emendas/index.json');
});

test('profile loads amendments lazily, renders separate measures, restos a pagar, sorted escaped destinations and method/source lines', async () => {
  const app = bootAppJs({
    fetchImpl: async url => {
      if (url === '/data/pub1/emendas/index.json') return { ok: true, json: async () => SAMPLE_INDEX };
      if (url === '/data/pub1/emendas/1.json') return { ok: true, json: async () => SAMPLE_DEPUTY_1 };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  assert.deepEqual(app.requests, [], 'no amendments request on initial load');

  app.clareia.profile('1');
  assert.equal(app.dialog.open, true, 'dialog opens immediately');
  assert.ok(app.amendmentsHtml().includes('Carregando…'), 'shows loading placeholder while fetching');

  await flush();
  const html = app.amendmentsHtml();
  assert.ok(html.indexOf('Emendas de 2025') < html.indexOf('Emendas de 2024'), 'years ordered newest first');

  // 2025 separate measures: committed 200000 (R$ 2.000,00), liquidated 160000 (R$ 1.600,00), paid 100000 (R$ 1.000,00)
  assert.match(html, /Empenhado<\/span><strong>R\$\s*2\.000,00<\/strong>/);
  assert.match(html, /Liquidado<\/span><strong>R\$\s*1\.600,00<\/strong>/);
  assert.match(html, /Pago<\/span><strong>R\$\s*1\.000,00<\/strong>/);
  assert.ok(!html.includes('4.600,00'), 'measures are never added together');

  // Restos a pagar line for 2025: 17000 (170,00), 3000 (30,00), 3500 (35,00)
  assert.match(html, /Restos a pagar:<\/strong>\s*Inscritos R\$\s*170,00 · Cancelados R\$\s*30,00 · Pagos R\$\s*35,00/);

  // Destinations sorted by paid descending, ties broken by name, with <b>x</b> escaped
  assert.ok(!html.includes('<b>x</b>'), 'raw HTML destination is escaped');
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'), 'escaped destination rendered literally');
  const posMultiplo = html.indexOf('MÚLTIPLO');
  const posEscaped = html.indexOf('&lt;b&gt;x&lt;/b&gt;');
  const posBa = html.indexOf('>BA<');
  assert.ok(posMultiplo > 0 && posEscaped > posMultiplo && posBa > posEscaped, 'destinations sorted by paid desc then name asc');
  assert.ok(html.includes('Nacional'), '2024 destination preserved verbatim');

  // Method & source wording
  assert.ok(html.includes('acumulados até a data do arquivo, por ano da emenda'));
  assert.ok(html.includes('localidade como a fonte escreve'));
  assert.ok(html.includes('Portal da Transparência (CGU), Emendas parlamentares'));
});

test('Voltar from Abrir registros re-renders the profile with the amendments block filled', async () => {
  const app = bootAppJs({
    fetchImpl: async url => {
      if (url === '/data/pub1/emendas/index.json') return { ok: true, json: async () => SAMPLE_INDEX };
      if (url === '/data/pub1/emendas/1.json') return { ok: true, json: async () => SAMPLE_DEPUTY_1 };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  app.clareia.profile('1');
  await flush();
  app.clickAction('records', '1');
  await flush();
  assert.equal(app.amendmentsHtml(), '', 'profile is no longer on screen');
  app.clickAction('dialog-back');
  await flush();
  const html = app.amendmentsHtml();
  assert.ok(html.includes('Emendas de 2025'), 'amendments block is filled after Voltar');
  assert.ok(!html.includes('Carregando…'));
});

test('profile for a deputy not in the index shows no-amendments text, no R$ 0, and makes no per-deputy request', async () => {
  const app = bootAppJs({
    fetchImpl: async url => {
      if (url === '/data/pub1/emendas/index.json') return { ok: true, json: async () => SAMPLE_INDEX };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  app.clareia.profile('2');
  await flush();
  const html = app.amendmentsHtml();
  assert.ok(html.includes('Sem emendas individuais ligadas a este deputado'));
  assert.ok(!html.includes('R$'), 'no R$ value shown for absent deputy');
  assert.deepEqual(app.requests, ['/data/pub1/emendas/index.json'], 'per-deputy file is never requested');
});

test('late amendment reply for a previous deputy is ignored after switching profiles', async () => {
  let releaseFirst!: () => void;
  const gate = new Promise<void>(r => { releaseFirst = r; });
  const app = bootAppJs({
    fetchImpl: async url => {
      if (url === '/data/pub1/emendas/index.json') return { ok: true, json: async () => SAMPLE_INDEX };
      if (url === '/data/pub1/emendas/1.json') { await gate; return { ok: true, json: async () => SAMPLE_DEPUTY_1 }; }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  app.clareia.profile('1');
  await flush();
  app.clareia.profile('2');
  await flush();
  assert.ok(app.amendmentsHtml().includes('Sem emendas individuais ligadas a este deputado'));

  releaseFirst();
  await flush();
  assert.ok(app.amendmentsHtml().includes('Sem emendas individuais ligadas a este deputado'), 'late reply for deputy 1 ignored');
  assert.ok(!app.amendmentsHtml().includes('MÚLTIPLO'));
});

test('failed index fetch, wrong schema and missing amendmentsIndexUrl show unavailable message with no zero and nothing throws', async () => {
  const UNAVAILABLE = 'Emendas indisponíveis nesta versão. Nenhum número foi estimado.';

  // 1) 404 index fetch (both profile and ranking tab)
  const app404 = bootAppJs({
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  app404.clareia.profile('1');
  await flush();
  assert.ok(app404.amendmentsHtml().includes(UNAVAILABLE));
  assert.ok(!app404.amendmentsHtml().includes('R$'));
  app404.clickTab('emendas');
  await flush();
  assert.ok(app404.elements['#rank-slot'].innerHTML.includes(UNAVAILABLE));
  assert.ok(!app404.elements['#rank-slot'].innerHTML.includes('R$ 0'));

  // 2) Wrong schema (not cached: retry after fix succeeds)
  let serveValid = false;
  const appBadSchema = bootAppJs({
    fetchImpl: async url => {
      if (url === '/data/pub1/emendas/index.json') {
        return { ok: true, json: async () => serveValid ? SAMPLE_INDEX : { schema: 'wrong.v1', deputies: [] } };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  appBadSchema.clickTab('emendas');
  await flush();
  assert.ok(appBadSchema.elements['#rank-slot'].innerHTML.includes(UNAVAILABLE));
  serveValid = true;
  appBadSchema.clareia.profile('1');
  await flush();
  assert.ok(appBadSchema.elements['#rank-slot'].innerHTML.includes('Carla Dias'), 'profile retry refreshes the Emendas ranking behind the dialog');

  // 3) Missing ClareiaData.amendmentsIndexUrl
  const appMissing = bootAppJs({ includeAmendmentsUrls: false });
  appMissing.clareia.profile('1');
  await flush();
  assert.ok(appMissing.amendmentsHtml().includes(UNAVAILABLE));
  appMissing.clickTab('emendas');
  await flush();
  assert.ok(appMissing.elements['#rank-slot'].innerHTML.includes(UNAVAILABLE));
  assert.ok(!appMissing.elements['#rank-slot'].innerHTML.includes('R$ 0'));
});

test('ranking tab ranks by year paid, omits absent deputies, handles empty state, ?aba=emendas, Senado switch, no monthly toggle, evidence and CSV', async () => {
  const fetchImpl: AppFetch = async url => {
    if (url === '/data/pub1/emendas/index.json') return { ok: true, json: async () => SAMPLE_INDEX };
    if (url === '/data/pub1/emendas/3.json') {
      return { ok: true, json: async () => ({ schema: 'clareia.amendments-deputy.v1', publicationId: 'am-pub-1', deputyId: 3, rows: [{ year: 2025, destination: 'SP', rows: 1, committed: 300000, liquidated: 260000, paid: 250000, carriedOver: 0, carriedCancelled: 0, carriedPaid: 0 }] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const app = bootAppJs({ search: '?aba=emendas', fetchImpl });
  assert.equal(app.clareia.state.tab, 'emendas', '?aba=emendas activates the tab');
  await flush();

  const rankHtml = app.elements['#rank-slot'].innerHTML;
  assert.ok(rankHtml.includes('data-tab="emendas" aria-selected="true"'));
  assert.ok(!rankHtml.includes('class="metric-toggle"'), 'hides Total / Por mês toggle');
  assert.ok(!rankHtml.includes('editorial-follow-up'), 'hides monthly follow-up');
  assert.ok(!rankHtml.includes('ceiling-pill'), 'hides ceiling pill');

  // Order: Carla Dias (250000) before Ana Souza (100000); Bruno Lima (not in index) omitted
  assert.ok(rankHtml.indexOf('Carla Dias') > 0 && rankHtml.indexOf('Ana Souza') > rankHtml.indexOf('Carla Dias'));
  assert.ok(!rankHtml.includes('Bruno Lima'), 'absent deputy is left out of ranking');

  // rankNote explains reviewed individual link and exclusions
  assert.ok(rankHtml.includes('ligação revisada de autoria'));
  assert.ok(rankHtml.includes('bancada, comissão e relator'));

  // Clicking evidence on emendas tab opens deputy profile amendments block, not cota gastos
  app.clickAction('evidence', '3');
  assert.equal(app.elements['#detail-title'].textContent, 'Perfil do representante');
  assert.equal(app.scrolledToAmendments(), true);
  await flush();
  assert.match(app.amendmentsHtml(), /Pago<\/span><strong>R\$\s*2\.500,00<\/strong>/);
  await app.clareia.closeDialog();

  // CSV export: unit reais (valor_reais), view names emendas pagas and year, only ranked deputies
  app.clickAction('csv-ranking');
  assert.equal(app.downloads.length, 1);
  const csv = app.downloads[0].text;
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines.length, 3, 'header + 2 ranked deputies only');
  assert.ok(lines[0].includes('"valor_reais"'), 'unit is reais');
  assert.ok(lines[1].includes('emendas individuais pagas (2025)'), 'view names emendas pagas and year');
  assert.ok(lines[1].includes('"Carla Dias"') && lines[1].includes('"2500,00"'));
  assert.ok(lines[2].includes('"Ana Souza"') && lines[2].includes('"1000,00"'));
  assert.ok(!csv.includes('Bruno Lima'));

  // UF filter respected -> RJ has no deputy with amendments -> empty state
  app.clareia.state.uf = 'RJ';
  app.clareia.refresh();
  const emptyHtml = app.elements['#rank-slot'].innerHTML;
  assert.ok(emptyHtml.includes('Nenhum deputado com emendas individuais ligadas para 2025 em RJ'));
  assert.ok(!emptyHtml.includes('bar-row'));
  app.clareia.state.uf = 'Brasil';
  app.clareia.refresh();

  // Switching to Senado resets emendas tab to gastos and hides Emendas tab
  app.clickHouse('senado');
  assert.equal(app.clareia.state.house, 'senado');
  assert.equal(app.clareia.state.tab, 'gastos');
  assert.ok(!app.elements['#rank-slot'].innerHTML.includes('data-tab="emendas"'));

  // Direct load with ?casa=senado&aba=emendas also resets to gastos
  const senadoDirect = bootAppJs({ search: '?casa=senado&aba=emendas', fetchImpl });
  assert.equal(senadoDirect.clareia.state.house, 'senado');
  assert.equal(senadoDirect.clareia.state.tab, 'gastos');
});

test('texts stop saying amendments are uncollected while keeping elections, assets and non-budget uses of emenda', () => {
  assert.ok(!PORTAL_JS.includes('Eleições, patrimônio e emendas ainda não foram coletados'));
  assert.ok(!PORTAL_JS.includes('patrimônio e emendas'));
  assert.ok(PORTAL_JS.includes('Eleições e patrimônio ainda não foram coletados'));
  assert.ok(PORTAL_JS.includes("destaque:'Emenda ou destaque'"));
  assert.ok(!APP_JS.includes('patrimônio e emendas ainda não foram coletados'));
  assert.ok(APP_JS.includes('emenda constitucional'));
  assert.ok(!PAGES_JS.includes('os próximos passos são as despesas completas de 2023 a 2026, as emendas parlamentares'));
});
