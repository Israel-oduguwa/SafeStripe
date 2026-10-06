import { readFile, access } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const base = new URL('../site-dist/', import.meta.url);
const pages = new Map();
for (const path of ['index.html', 'docs/handbook.html']) {
  pages.set(path, parseHTML(await readFile(new URL(path, base), 'utf8')));
}
let checked = 0;
for (const [path, { document }] of pages) {
  const page = new URL(path, base);
  for (const element of document.querySelectorAll('a[href],script[src],link[href]')) {
    const href = element.getAttribute('href') || element.getAttribute('src');
    const target = new URL(href, page);
    if (target.protocol !== 'file:') continue;
    if (target.pathname.endsWith('/')) target.pathname += 'index.html';
    const hash = target.hash.slice(1);
    target.hash = '';
    await access(target);
    const local = target.href.slice(base.href.length);
    if (hash && pages.has(local))
      assert.ok(pages.get(local).document.getElementById(hash), 'Missing anchor: ' + href);
    checked++;
  }
}
const { document, window } = pages.get('index.html');
let copied;
runInNewContext(await readFile(new URL('site.js', base), 'utf8'), {
  document,
  navigator: {
    clipboard: {
      writeText: async (value) => {
        copied = value;
      },
    },
  },
});
document.getElementById('next-tab').click();
assert.equal(document.getElementById('next-code').hidden, false);
assert.equal(document.getElementById('express-code').hidden, true);
const event = new window.Event('keydown', { bubbles: true, cancelable: true });
event.key = 'Home';
document.getElementById('next-tab').dispatchEvent(event);
assert.equal(document.getElementById('express-code').hidden, false);
document.getElementById('copy-install').click();
await new Promise((resolve) => setImmediate(resolve));
const release = JSON.parse(
  await readFile(new URL('../site/release.json', import.meta.url), 'utf8'),
);
assert.equal(document.getElementById('copy-install').disabled, release.npmPublished !== true);
assert.equal(copied, release.npmPublished === true ? 'npm install safestripe' : undefined);
console.log(
  'Website checked: ' +
    checked +
    ' local links; framework tabs, keyboard switching and install copy.',
);
