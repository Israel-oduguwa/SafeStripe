import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import assert from 'node:assert/strict';
const html = await readFile(new URL('../docs/handbook.html', import.meta.url), 'utf8');
const { document, window: dom } = parseHTML(html);
const preferences = new Map();
const callbacks = new Map();
let copied = '';
const location = { hash: '#11-getting-started' };
const window = {
  scrollTo() {},
  print() {},
  addEventListener(name, fn) {
    callbacks.set(name, fn);
  },
};
const context = {
  document,
  window,
  location,
  Event: dom.Event,
  navigator: {
    clipboard: {
      async writeText(value) {
        copied = value;
      },
    },
  },
  localStorage: {
    getItem: (key) => preferences.get(key),
    setItem: (key, value) => preferences.set(key, value),
  },
  setTimeout: () => 0,
};
runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
assert.equal(document.querySelector('article:not([hidden])').id, '11-getting-started');
const database = document.querySelector('[data-tabs="database"]');
assert.equal(database.querySelectorAll('[role="tab"]').length, 4);
assert.equal(database.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1);
database.querySelector('[data-choice="MongoDB"]').click();
for (const group of document.querySelectorAll('[data-tabs="database"]')) {
  assert.equal(group.querySelector('[aria-selected="true"]').dataset.choice, 'MongoDB');
  assert.equal(group.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1);
}
const framework = document.querySelector('[data-tabs="framework"]');
framework.querySelector('[data-choice="Next.js"]').click();
for (const group of document.querySelectorAll('[data-tabs="framework"]'))
  assert.equal(group.querySelector('[aria-selected="true"]').dataset.choice, 'Next.js');
const key = new dom.Event('keydown', { bubbles: true, cancelable: true });
key.key = 'Home';
const first = framework.querySelector('[data-choice="Express.js"]');
first.focus = () => {};
framework.querySelector('[data-choice="Next.js"]').dispatchEvent(key);
assert.equal(framework.querySelector('[aria-selected="true"]').dataset.choice, 'Express.js');
const block = document.querySelector('.code-block');
block.querySelector('.copy-code').click();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(copied, block.querySelector('code').textContent);
assert.ok(!copied.includes('Copy'));
assert.equal(block.querySelector('.copy-code').textContent, 'Copied');
assert.ok(document.querySelectorAll('.shiki span[style]').length > 100);
const search = document.querySelector('#search');
search.value = 'MongoDB';
search.dispatchEvent(new dom.Event('input'));
assert.match(document.querySelector('#search-status').textContent, /matching guides/);
assert.ok(document.querySelectorAll('[data-page]:not([hidden])').length > 1);
location.hash = '#17-payment-ui';
callbacks.get('hashchange')();
assert.equal(document.querySelector('article:not([hidden])').id, '17-payment-ui');
assert.match(document.title, /payment form/i);
console.log(
  'Documentation UI verified: tabs synchronize, keyboard navigation, copy, syntax colors, search and page navigation. DOM test only; no rendered visual review.',
);
