import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHighlighter } from 'shiki';
import { format } from 'prettier';

const source = new URL('../site/', import.meta.url);
const output = new URL('../site-dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const highlighter = await createHighlighter({ themes: ['dark-plus'], langs: ['typescript'] });
let html = await readFile(new URL('index.html', source), 'utf8');
const release = JSON.parse(await readFile(new URL('release.json', source), 'utf8'));
if (release.npmPublished === true) {
  html = html.replace(
    /<p class="release-note" id="release-note">[\s\S]*?<\/p>/,
    '<p class="release-note" id="release-note">Available on npm · MIT licensed</p>',
  );
} else {
  html = html.replace(
    'id="copy-install"',
    'id="copy-install" disabled title="This prepared release is not available on npm yet"',
  );
}
for (const framework of ['express', 'next']) {
  const snippet = await format(await readFile(new URL(framework + '.ts.txt', source), 'utf8'), {
    parser: 'typescript',
    singleQuote: true,
    printWidth: 66,
  });
  html = html.replace(
    '<!-- ' + framework.toUpperCase() + '_CODE -->',
    highlighter.codeToHtml(snippet.trimEnd(), { lang: 'typescript', theme: 'dark-plus' }),
  );
}
highlighter.dispose();
await writeFile(new URL('index.html', output), html);
for (const name of ['styles.css', 'site.js', 'favicon.svg'])
  await cp(new URL(name, source), new URL(name, output));
// Copy only tracked examples and public guides, never local configuration or build output.
const { execFileSync } = await import('node:child_process');
const files = execFileSync(
  'git',
  [
    'ls-files',
    '-z',
    'docs',
    'examples',
    'maintainer/README.md',
    'benchmarks/README.md',
    'benchmarks/results',
  ],
  {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);
for (const name of files) {
  if (name.split('/').some((part) => part.startsWith('.'))) continue;
  const target = new URL(name, output);
  await mkdir(new URL('.', target), { recursive: true });
  await cp(new URL('../' + name, import.meta.url), target);
}
for (const name of [
  'README.md',
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'VERIFICATION.md',
  'CONTRIBUTING.md',
]) {
  await cp(new URL('../' + name, import.meta.url), new URL(name, output));
}
console.log('Built site-dist: landing page, searchable documentation and linked examples.');
