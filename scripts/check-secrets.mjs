import { execFileSync } from 'node:child_process';
const names = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const pattern = /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bwhsec_[A-Za-z0-9]{16,}\b/;
let failed = false;
for (const name of names) {
  const content = execFileSync('git', ['show', `:${name}`], { maxBuffer: 20 * 1024 * 1024 });
  if (content.includes(0)) continue;
  if (pattern.test(content.toString('utf8'))) {
    console.error(`Possible Stripe credential in staged file: ${name}`);
    failed = true;
  }
}
if (failed) {
  console.error('Remove credentials from staged content. Rotate any exposed key.');
  process.exitCode = 1;
}
