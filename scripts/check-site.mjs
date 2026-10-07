import { readFile, access } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { sitePages, benchmarkFiles, renderBenchmarks, escapeHtml, number } from './site-pages.mjs';
import './check-support.mjs';

const base = new URL('../site-dist/', import.meta.url);
const pages = new Map();
for (const path of [
  ...sitePages.map((page) => (page.slug ? page.slug + '/index.html' : 'index.html')),
  'docs/handbook.html',
]) {
  pages.set(path, parseHTML(await readFile(new URL(path, base), 'utf8')));
}
let checked = 0;
const canonicals = new Set();
for (const [path, { document }] of pages) {
  assert.equal(document.querySelectorAll('main').length, 1, path + ': one main landmark');
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(ids.length, new Set(ids).size, path + ': unique IDs');
  for (const element of document.querySelectorAll('a[href],script[src],link[href],img[src]')) {
    const href = element.getAttribute('href') || element.getAttribute('src');
    const target = new URL(href, new URL(path, base));
    if (target.protocol !== 'file:') continue;
    assert.ok(target.href.startsWith(base.href), 'Link leaves output directory: ' + href);
    if (target.pathname.endsWith('/')) target.pathname += 'index.html';
    const hash = decodeURIComponent(target.hash.slice(1));
    target.hash = '';
    await access(target);
    const local = target.href.slice(base.href.length);
    if (hash && pages.has(local))
      assert.ok(pages.get(local).document.getElementById(hash), path + ': missing anchor ' + href);
    checked++;
  }
  if (path === 'docs/handbook.html') continue;
  assert.equal(document.querySelectorAll('h1').length, 1, path + ': one page heading');
  assert.ok(document.querySelector('title').textContent);
  assert.ok(document.querySelector('meta[name="description"]').getAttribute('content'));
  const canonical = document.querySelector('link[rel="canonical"]').getAttribute('href');
  assert.ok(!canonicals.has(canonical), 'Duplicate canonical');
  canonicals.add(canonical);
  const nav = document.querySelector('#site-navigation');
  assert.equal(nav.querySelectorAll('a').length, 6);
  assert.equal(
    nav.querySelectorAll('[aria-current="page"]').length,
    ['index.html', 'get-started/index.html'].includes(path) ? 0 : 1,
  );
  assert.ok(!document.documentElement.outerHTML.includes('{{'), 'Unresolved template');
  assert.ok(document.getElementById('main'));
}
let copied;
function initialize(path, clipboardFails = false) {
  const page = pages.get(path);
  runInNewContext(client, {
    document: page.document,
    navigator: {
      clipboard: {
        writeText: async (value) => {
          if (clipboardFails) throw new Error('Unavailable');
          copied = value;
        },
      },
    },
  });
  return page;
}
function key(page, node, value) {
  const event = new page.window.Event('keydown', { bubbles: true, cancelable: true });
  event.key = value;
  node.dispatchEvent(event);
}
const client = await readFile(new URL('site.js', base), 'utf8');
const examples = initialize('examples/index.html');
examples.document.getElementById('next-tab').click();
assert.equal(examples.document.getElementById('next-code').hidden, false);
assert.equal(examples.document.getElementById('express-code').hidden, true);
key(examples, examples.document.getElementById('next-tab'), 'Home');
assert.equal(examples.document.getElementById('express-code').hidden, false);

const benchmarkPage = pages.get('benchmarks/index.html');
const reportData = await Promise.all(
  benchmarkFiles.map(async (config) => ({
    ...config,
    data: JSON.parse(await readFile(new URL('benchmarks/results/' + config.file, base), 'utf8')),
  })),
);
for (const report of reportData) {
  const panel = benchmarkPage.document.getElementById(report.id + '-panel');
  // Without JavaScript, every retained configuration remains readable.
  assert.equal(panel.hidden, false);
  assert.equal(
    panel.querySelector('[data-measurements="throughput"] tbody').children.length,
    report.data.results.length,
  );
  const throughputRows = [...panel.querySelectorAll('[data-measurements="throughput"] tbody tr')];
  for (const [i, row] of throughputRows.entries()) {
    const cells = [...row.children].map((cell) => cell.textContent);
    const raw = report.data.results[i];
    assert.deepEqual(cells, [
      number(i + 1),
      number(raw.admissionAttemptsPerSecond),
      number(raw.committedEffectsPerSecond),
      number(raw.transactionCallbackRetries),
      number(raw.workerErrors),
      number(raw.retryableTransactionFailures),
      number(raw.duplicateEffects),
    ]);
  }
  assert.equal(
    panel.querySelectorAll('[data-measurements="latency"] tbody tr').length,
    report.data.results.length * 3,
  );
  assert.ok(panel.textContent.includes(report.data.environment.cpu));
  assert.ok(panel.textContent.includes(report.data.sourceSha256));
}
assert.ok(
  benchmarkPage.document.getElementById('sqlite-panel').textContent.includes('Not recorded'),
);
assert.ok(
  benchmarkPage.document
    .getElementById('postgres-4-panel')
    .querySelector('.warmup-note')
    .textContent.includes('3 failed worker attempts'),
);
assert.equal(
  benchmarkPage.document.querySelectorAll('[data-measurements="original-attempts"] tbody tr')
    .length,
  3,
);
const bench = initialize('benchmarks/index.html');
const benchTabs = [...bench.document.querySelectorAll('[role="tab"]')];
key(bench, benchTabs[0], 'ArrowLeft');
assert.equal(benchTabs.at(-1).getAttribute('aria-selected'), 'true');
assert.equal(bench.document.getElementById('sqlite-panel').hidden, false);
key(bench, benchTabs.at(-1), 'Home');
assert.equal(bench.document.getElementById('postgres-1-panel').hidden, false);
assert.equal(bench.document.getElementById('sqlite-panel').hidden, true);
key(bench, benchTabs[0], 'End');
assert.equal(benchTabs.at(-1).getAttribute('tabindex'), '0');
key(bench, benchTabs.at(-1), 'ArrowRight');
assert.equal(benchTabs[0].getAttribute('aria-selected'), 'true');

const home = initialize('index.html');
const menu = home.document.querySelector('.menu-toggle');
assert.equal(menu.hidden, false);
menu.click();
assert.equal(menu.getAttribute('aria-expanded'), 'true');
key(home, menu, 'Escape');
assert.equal(menu.getAttribute('aria-expanded'), 'false');
menu.click();
home.document.querySelector('#site-navigation a').click();
assert.equal(menu.getAttribute('aria-expanded'), 'false');

const release = JSON.parse(
  await readFile(new URL('../site/release.json', import.meta.url), 'utf8'),
);
for (const path of ['index.html', 'get-started/index.html']) {
  const page = path === 'index.html' ? home : initialize(path);
  copied = undefined;
  page.document.getElementById('copy-install').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    page.document.getElementById('copy-install').disabled,
    release.npmPublished !== true,
  );
  assert.equal(copied, release.npmPublished === true ? 'npm install safestripe' : undefined);
}
bench.document.querySelector('[data-copy="postgres-command"]').click();
await new Promise((resolve) => setImmediate(resolve));
assert.ok(copied.includes('BENCH_WORKERS=8 npm run benchmark'));
const pendingCopy = parseHTML(await readFile(new URL('index.html', base), 'utf8'));
let finishCopy;
let copyCalls = 0;
runInNewContext(client, {
  document: pendingCopy.document,
  navigator: {
    clipboard: {
      writeText: () => {
        copyCalls++;
        return new Promise((resolve) => {
          finishCopy = resolve;
        });
      },
    },
  },
});
const pendingButton = pendingCopy.document.getElementById('copy-install');
if (release.npmPublished) {
  pendingButton.click();
  pendingButton.click();
  assert.equal(copyCalls, 1);
  assert.equal(pendingButton.getAttribute('aria-busy'), 'true');
  assert.equal(pendingButton.disabled, true);
  finishCopy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingButton.hasAttribute('aria-busy'), false);
  assert.equal(pendingButton.disabled, false);
  assert.equal(pendingButton.textContent.trim(), 'Copy');
}
const fallback = parseHTML(await readFile(new URL('index.html', base), 'utf8'));
runInNewContext(client, {
  document: fallback.document,
  navigator: {
    clipboard: {
      writeText: async () => {
        throw new Error('Denied');
      },
    },
  },
});
fallback.document.getElementById('copy-install').click();
await new Promise((resolve) => setImmediate(resolve));
if (release.npmPublished)
  assert.ok(
    fallback.document.getElementById('copy-status').textContent.includes('Select the command'),
  );

assert.equal(number(undefined), 'Not recorded');
assert.throws(() => number(NaN), /Invalid benchmark/);
assert.throws(() => number(-1), /Invalid benchmark/);
assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
const invalid = structuredClone(reportData);
invalid[0].data.results[0].counts.effects++;
assert.throws(() => renderBenchmarks(invalid), /business invariant/);
invalid[0].data.results[0].counts.effects--;
invalid[0].data.results[0].duplicateEffects = 1;
assert.throws(() => renderBenchmarks(invalid), /duplicate effects/);
const sitemap = parseHTML(await readFile(new URL('sitemap.xml', base), 'utf8')).document;
assert.equal(sitemap.querySelectorAll('loc').length, sitePages.length + 1);
console.log(
  'Website checked: six pages and handbook, ' +
    checked +
    ' local links; benchmark provenance, missing metrics, keyboard tabs, mobile menu and clipboard behavior.',
);
