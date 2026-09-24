import { readFile, readdir, writeFile } from 'node:fs/promises';
import { marked } from 'marked';
import { createHash } from 'node:crypto';
import { createHighlighter } from 'shiki';
import { format } from 'prettier';

const directory = new URL('../docs/', import.meta.url);
const groups = [
  ['Start here', ['00-reading-guide', '11-getting-started', '03-quickstart']],
  ['Build your app', ['16-frameworks', '15-databases', '17-payment-ui', '18-recipes']],
  [
    'Deploy and scale',
    ['14-deployment-and-publishing', '19-enterprise', '20-upgrading', '13-what-safestripe-solves'],
  ],
  [
    'Payment concepts',
    [
      '01-objects-and-state',
      '02-distributed-architecture',
      '04-billing-and-finance',
      '07-security-and-scale',
    ],
  ],
  [
    'Operate and review',
    ['05-operations-workbook', '06-evaluation-and-recording', '08-testing-and-runbooks'],
  ],
  ['Reference', ['09-library-reference', '12-integration', '10-sources-and-corrections']],
];
const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const slug = (value) =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/&[^;]+;/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const highlighter = await createHighlighter({
  themes: ['dark-plus'],
  langs: [
    'typescript',
    'tsx',
    'javascript',
    'json',
    'bash',
    'sql',
    'dotenv',
    'yaml',
    'html',
    'css',
  ],
});
const aliases = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  text: 'text',
  mermaid: 'text',
};
marked.use({
  async: true,
  walkTokens: async (token) => {
    if (token.type !== 'code') return;
    const lang = (token.lang ?? '').split(/\s+/)[0];
    const parser = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'babel',
      json: 'json',
      css: 'css',
      html: 'html',
      yaml: 'yaml',
    }[lang];
    if (parser) {
      try {
        token.text = (
          await format(token.text, { parser, printWidth: 88, tabWidth: 2, singleQuote: true })
        ).trimEnd();
      } catch {
        /* Partial patterns retain their original formatting. */
      }
    }
  },
  renderer: {
    code(token) {
      const language = (token.lang ?? 'text').split(/\s+/)[0];
      const lang = aliases[language] ?? language;
      const supported = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
      const code = highlighter.codeToHtml(token.text, { lang: supported, theme: 'dark-plus' });
      return `<div class="code-block"><div class="code-toolbar"><span><i></i><i></i><i></i></span><span class="code-language">${escape(language)}</span><button type="button" class="copy-code" aria-label="Copy code">Copy</button></div>${code}<span class="copy-status" role="status"></span></div>`;
    },
  },
});
let tabGroup = 0;
async function renderMarkdown(source, pageId) {
  const pattern = /^:::tabs (framework|database)\n([\s\S]*?)^:::endtabs\s*$/gm;
  let position = 0;
  let result = '';
  for (const match of source.matchAll(pattern)) {
    result += source.slice(position, match.index);
    const panels = [...match[2].matchAll(/^:::tab ([^\n]+)\n([\s\S]*?)(?=^:::tab |$(?![\s\S]))/gm)];
    if (panels.length < 2) throw new Error(`Invalid tab group in ${pageId}`);
    const groupId = `${pageId}-tabs-${++tabGroup}`;
    let markup = `<div class="snippet-tabs" data-tabs="${match[1]}"><div class="tab-buttons" role="tablist" aria-label="Choose ${match[1]}">`;
    panels.forEach((panel, index) => {
      markup += `<button type="button" role="tab" id="${groupId}-tab-${index}" aria-controls="${groupId}-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-choice="${escape(panel[1])}">${escape(panel[1])}</button>`;
    });
    markup += '</div>';
    for (const [index, panel] of panels.entries())
      markup += `<div role="tabpanel" id="${groupId}-panel-${index}" aria-labelledby="${groupId}-tab-${index}">${await marked.parse(panel[2])}</div>`;
    result += `\n${markup}</div>\n\n`;
    position = match.index + match[0].length;
  }
  result += source.slice(position);
  return marked.parse(result);
}
const files = (await readdir(directory)).filter((name) => /^\d{2}-.*\.md$/.test(name));
const order = groups.flatMap(([, ids]) => ids);
if (files.length !== order.length || files.some((name) => !order.includes(name.slice(0, -3))))
  throw new Error('Every documentation page must appear in the navigation');
const pages = [];
for (const id of order) {
  const source = await readFile(new URL(`${id}.md`, directory), 'utf8');
  const title = source.match(/^# (.+)/m)?.[1] ?? id;
  let html = await renderMarkdown(source, id);
  const used = new Map();
  const headings = [];
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_match, level, label) => {
    const base = slug(label);
    const number = used.get(base) ?? 0;
    used.set(base, number + 1);
    const anchor = `${id}--${base}${number ? `-${number}` : ''}`;
    if (level === '2') headings.push({ anchor, label: label.replace(/<[^>]*>/g, '') });
    return `<h${level} id="${anchor}">${label}</h${level}>`;
  });
  html = html.replace(
    /href="(\d{2}-[^"#]+)\.md(?:#([^"]*))?"/g,
    (_match, page, anchor) => `href="#${page}${anchor ? `--${anchor}` : ''}"`,
  );
  html = html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
  html = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_match, code) =>
      `<figure class="flow" aria-label="Payment flow"><div>Authenticate<br><strong>Validate order</strong></div><span>→</span><div>Persist operation<br><strong>Call Stripe</strong></div><span>→</span><div>Verify event<br><strong>Store inbox</strong></div><span>→</span><div>Worker transaction<br><strong>Update order</strong></div></figure><details><summary>Sequence diagram source</summary><pre><code>${code}</code></pre></details>`,
  );
  pages.push({ id, title, html, headings });
}
const script = await readFile(new URL('docs-ui.js', import.meta.url), 'utf8');
const css = await readFile(new URL('docs.css', import.meta.url), 'utf8');
const hash = createHash('sha256').update(script).digest('base64');
const nav = groups
  .map(
    ([name, ids]) =>
      `<div class="nav-group"><h2>${name}</h2>${ids
        .map((id) => {
          const page = pages.find((page) => page.id === id);
          return `<a data-page="${id}" href="#${id}">${escape(page.title)}</a>`;
        })
        .join('')}</div>`,
  )
  .join('');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Build reliable Stripe integrations with Node.js, Express, Next.js, SQLite, PostgreSQL, MongoDB and Firebase. Tutorials, API reference and payment operations guides."><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; img-src data:; base-uri 'none'; form-action 'none'"><title>SafeStripe documentation</title><style>${css}</style></head>
<body><a class="skip" href="#content">Skip to content</a><header class="topbar"><a class="brand" href="#00-reading-guide"><span class="mark">S</span>SafeStripe <span class="doc-label">Docs</span></a><span class="release">0.2.0 · Node.js 22.19+</span><button id="print" type="button">Print all pages</button></header>
<aside class="sidebar"><label for="search">Find a guide</label><div class="search-box"><input id="search" type="search" placeholder="Search documentation" autocomplete="off"><kbd>/</kbd></div><p id="search-status" role="status">${pages.length} guides · available offline</p><nav aria-label="Documentation">${nav}</nav><p class="sidebar-foot">Stripe API<br><code>2026-08-26.dahlia</code></p></aside>
<div class="layout"><main id="content" tabindex="-1">${pages.map((page) => `<article id="${page.id}" data-title="${escape(page.title)}"><div class="eyebrow">${escape(groups.find(([, ids]) => ids.includes(page.id))[0])}</div>${page.html}<div class="page-end">SafeStripe 0.2.0 · Reviewed 24 September 2026</div></article>`).join('\n')}<nav class="pager" aria-label="Adjacent pages"><a id="previous"></a><a id="next"></a></nav><footer>MIT licensed. Independent of Stripe. <a href="../LICENSE">License</a> · <a href="../VERIFICATION.md">Verification record</a></footer></main><aside class="on-this-page" aria-label="On this page"><h2>On this page</h2>${pages.map((page) => `<nav data-toc="${page.id}">${page.headings.map((heading) => `<a href="#${heading.anchor}">${heading.label}</a>`).join('')}</nav>`).join('')}</aside></div><script>${script}</script></body></html>`;
await writeFile(new URL('handbook.html', directory), html);
highlighter.dispose();
console.log(
  `Built documentation: ${pages.length} pages with navigation, search and section links.`,
);
