import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHighlighter } from 'shiki';
import { format } from 'prettier';
import { supportMarkup } from './support-page.mjs';
import {
  sitePages,
  benchmarkFiles,
  escapeHtml,
  renderBenchmarks,
  renderAttempts,
} from './site-pages.mjs';

const source = new URL('../site/', import.meta.url);
const output = new URL('../site-dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const layout = await readFile(new URL('layout.html', source), 'utf8');
const support = supportMarkup(
  JSON.parse(await readFile(new URL('support.json', source), 'utf8')).url,
);
const release = JSON.parse(await readFile(new URL('release.json', source), 'utf8'));
const readResult = async (file) =>
  JSON.parse(await readFile(new URL('../benchmarks/results/' + file, import.meta.url), 'utf8'));
const reports = await Promise.all(
  benchmarkFiles.map(async (config) => ({ ...config, data: await readResult(config.file) })),
);
const attempts = await Promise.all(
  [1, 4, 8].map(async (workers) => {
    const file = 'postgres-' + workers + '-initial.json';
    return { file, data: await readResult(file) };
  }),
);
const benchmarkMarkup = renderBenchmarks(reports);
const attemptMarkup = renderAttempts(attempts);
const highlighter = await createHighlighter({ themes: ['dark-plus'], langs: ['typescript'] });
const snippets = {};
for (const framework of ['express', 'next']) {
  const snippet = await format(await readFile(new URL(framework + '.ts.txt', source), 'utf8'), {
    parser: 'typescript',
    singleQuote: true,
    printWidth: 66,
  });
  snippets[framework] = highlighter.codeToHtml(snippet.trimEnd(), {
    lang: 'typescript',
    theme: 'dark-plus',
  });
}
highlighter.dispose();
const navigation = [
  ['demo', 'Demo'],
  ['reliability', 'Reliability'],
  ['benchmarks', 'Benchmarks'],
  ['examples', 'Examples'],
  ['releases', 'Releases'],
  ['docs/handbook.html', 'Docs'],
];
for (const page of sitePages) {
  const base = page.slug ? '../' : './';
  let content = await readFile(new URL(page.source, source), 'utf8');
  content = content
    .replace('<!-- EXPRESS_CODE -->', snippets.express)
    .replace('<!-- NEXT_CODE -->', snippets.next)
    .replace('{{BENCHMARK_REPORTS}}', benchmarkMarkup)
    .replace('{{BENCHMARK_ATTEMPTS}}', attemptMarkup);
  if (!release.npmPublished)
    content = content.replace(
      'id="copy-install"',
      'id="copy-install" disabled title="This release is not available on npm yet"',
    );
  const replacements = {
    TITLE: escapeHtml(page.title),
    DESCRIPTION: escapeHtml(page.description),
    CANONICAL: 'https://israel-oduguwa.github.io/SafeStripe/' + (page.slug ? page.slug + '/' : ''),
    BASE: base,
    NAVIGATION: navigation
      .map(
        ([slug, label]) =>
          '<a href="' +
          base +
          slug +
          (slug.includes('.') ? '' : '/') +
          '"' +
          (slug === page.slug ? ' aria-current="page"' : '') +
          '>' +
          label +
          '</a>',
      )
      .join(''),
    CONTENT: content,
    SUPPORT_BUTTON: support.button,
    SUPPORT_DIALOG: support.dialog,
  };
  const html = layout.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
    if (!(name in replacements)) throw new Error('Unknown page token: ' + name);
    return replacements[name];
  });
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('Unresolved page token: ' + page.slug);
  const target = new URL(page.slug ? page.slug + '/index.html' : 'index.html', output);
  await mkdir(new URL('.', target), { recursive: true });
  await writeFile(target, html);
}
await writeFile(
  new URL('sitemap.xml', output),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    sitePages
      .map(
        (page) =>
          '<url><loc>https://israel-oduguwa.github.io/SafeStripe/' +
          (page.slug ? page.slug + '/' : '') +
          '</loc></url>',
      )
      .join('') +
    '<url><loc>https://israel-oduguwa.github.io/SafeStripe/docs/handbook.html</loc></url></urlset>\n',
);
for (const name of ['styles.css', 'site.js', 'favicon.svg', 'support.css', 'support.js'])
  await cp(new URL(name, source), new URL(name, output));
// Explicit media allowlist: no local renders, private notes or contact lists.
const demoAssets = [
  'safestripe-recovery.mp4',
  'safestripe-recovery-vertical.mp4',
  'safestripe-recovery-4k.mp4',
  'safestripe-recovery-vertical-4k.mp4',
  'poster.jpg',
  'poster-vertical.jpg',
  'captions.vtt',
  'manifest.json',
  'MEDIA-NOTICES.md',
];
await mkdir(new URL('launch/demo/', output), { recursive: true });
for (const name of demoAssets)
  await cp(
    new URL('../launch/demo/' + name, import.meta.url),
    new URL('launch/demo/' + name, output),
  );
// Publish only tracked examples and guides, never local configuration or build output.
const files = execFileSync(
  'git',
  [
    'ls-files',
    '-z',
    'docs',
    'examples',
    'maintainer/README.md',
    'maintainer/LAUNCH.md',
    'benchmarks/README.md',
    'benchmarks/results',
  ],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
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
])
  await cp(new URL('../' + name, import.meta.url), new URL(name, output));
console.log(
  `Built ${sitePages.length} website pages, a sitemap, searchable documentation and linked evidence.`,
);
