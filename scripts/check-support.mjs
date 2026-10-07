import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { supportMarkup, validateSupportUrl } from './support-page.mjs';

assert.deepEqual(supportMarkup(null), { button: '', dialog: '' });
for (const value of [
  'http://buymeacoffee.com/example',
  'https://buymeacoffee.com.evil.example/example',
  'https://user:password@buymeacoffee.com/example',
  'https://buymeacoffee.com/example?next=elsewhere',
  'https://buymeacoffee.com/',
  'https://buymeacoffee.com/example/another-page',
])
  assert.throws(() => validateSupportUrl(value));

// A test destination is never written into the generated public site.
const { button, dialog } = supportMarkup('https://buymeacoffee.com/example');
const { document, window } = parseHTML(`<html><body>${button}${dialog}</body></html>`);
const modal = document.getElementById('support-dialog');
let opens = 0;
let restored = false;
modal.showModal = () => {
  modal.open = true;
  opens++;
};
modal.close = () => {
  modal.open = false;
  modal.dispatchEvent(new window.Event('close'));
};
document.querySelector('[data-support-open]').focus = () => {
  restored = true;
};
runInNewContext(await readFile(new URL('../site/support.js', import.meta.url), 'utf8'), {
  document,
});
assert.equal(opens, 0, 'Support must never open automatically.');
document.querySelector('[data-support-open]').click();
document.querySelector('[data-support-open]').click();
assert.equal(opens, 1);
document.querySelector('[data-support-close]').click();
assert.equal(modal.open, false);
assert.equal(restored, true);
assert.equal(
  document.querySelector('[data-support-link]').getAttribute('rel'),
  'noopener noreferrer',
);
console.log(
  'Support checked: destination validation, voluntary open, close and focus restoration.',
);
