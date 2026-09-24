import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const markdown = [
  'README.md',
  'SECURITY.md',
  'VERIFICATION.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  ...(await readdir(path.join(root, 'docs')))
    .filter((x) => x.endsWith('.md'))
    .map((x) => `docs/${x}`),
];
let links = 0;
for (const file of markdown) {
  const content = await readFile(path.join(root, file), 'utf8');
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
    await access(path.resolve(root, path.dirname(file), target.split('#')[0]));
    links++;
  }
}
const html = await readFile(path.join(root, 'docs/handbook.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]));
for (const match of html.matchAll(/href="#([^"]+)"/g))
  if (!ids.has(match[1])) throw new Error(`Broken handbook anchor: ${match[1]}`);
const pageCount = (await readdir(path.join(root, 'docs'))).filter((name) =>
  /^\d{2}-.*\.md$/.test(name),
).length;
if ((html.match(/<article\b/g) ?? []).length !== pageCount)
  throw new Error('Documentation page count mismatch');
const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
if (new Set(allIds).size !== allIds.length) throw new Error('Duplicate documentation anchor');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('Missing handbook script');
new Script(script);
const hash = createHash('sha256').update(script).digest('base64');
if (!html.includes(`'sha256-${hash}'`)) throw new Error('Handbook CSP hash mismatch');
console.log(
  `Documentation verified: ${markdown.length} Markdown files, ${links} local links, ${pageCount} HTML pages, valid anchors and script hash.`,
);
