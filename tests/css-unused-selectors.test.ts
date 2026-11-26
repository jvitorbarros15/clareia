import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const NESTING_AT_RULES = new Set(['media', 'supports', 'starting-style', 'layer', 'container', 'scope', 'document']);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') { i += 2; continue; }
    if (css[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") { i = skipString(css, i) - 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced '{' at index ${openIndex}`);
}

function collectClassesFromSelector(selector: string, out: Set<string>): void {
  let cleaned = '';
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '[') {
      i++;
      while (i < selector.length && selector[i] !== ']') {
        if (selector[i] === '"' || selector[i] === "'") i = skipString(selector, i);
        else i++;
      }
      continue;
    }
    cleaned += ch;
  }
  for (const m of cleaned.matchAll(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g)) {
    if (m[1]) out.add(m[1]);
  }
}

function parseBlock(css: string, out: Set<string>): void {
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") { i = skipString(css, i); continue; }
    if (ch === ';') { i++; start = i; continue; }
    if (ch === '}') throw new Error(`Unexpected '}' at index ${i}`);
    if (ch === '{') {
      const prelude = css.slice(start, i).trim();
      const close = findMatchingBrace(css, i);
      const body = css.slice(i + 1, close);
      if (prelude.startsWith('@')) {
        const name = /^@([a-zA-Z-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
        if (NESTING_AT_RULES.has(name)) parseBlock(body, out);
      } else if (prelude) {
        collectClassesFromSelector(prelude, out);
      }
      i = close + 1;
      start = i;
      continue;
    }
    i++;
  }
}

function extractClassSelectors(css: string): Set<string> {
  const classes = new Set<string>();
  parseBlock(stripComments(css), classes);
  return classes;
}

function isClassUsed(className: string, corpus: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`).test(corpus);
}

async function readSourceCorpus(): Promise<string> {
  const chunks: string[] = [];
  const walk = async (dir: string, exts: Set<string>): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, exts);
      else if (exts.has(path.extname(entry.name))) chunks.push(await fs.readFile(full, 'utf8'));
    }
  };
  await walk(path.join(ROOT, 'real'), new Set(['.html', '.js']));
  await walk(path.join(ROOT, 'src'), new Set(['.ts']));
  return chunks.join('\n');
}

test('every class selector in real/styles.css appears in real/ or src/ sources', async () => {
  const [css, corpus] = await Promise.all([
    fs.readFile(path.join(ROOT, 'real', 'styles.css'), 'utf8'),
    readSourceCorpus(),
  ]);
  const classes = extractClassSelectors(css);
  assert.ok(classes.size > 100, `expected stylesheet classes, found ${classes.size}`);
  const unused = [...classes].filter(name => !isClassUsed(name, corpus)).sort();
  assert.deepEqual(unused, [], `unused class selectors in real/styles.css: ${unused.join(', ')}`);
});

test('the unused-selector check flags clearly dead classes', async () => {
  const corpus = await readSourceCorpus();
  for (const dead of ['demo-badge', 'motion-toggle', 'project-grid', 'category-path', 'api-discrepancy']) {
    const found = extractClassSelectors(`@media(max-width:700px){body[data-model=editorial] .${dead}{color:red}}`);
    assert.ok(found.has(dead));
    assert.equal(isClassUsed(dead, corpus), false, `${dead} should not match sources`);
  }
});
