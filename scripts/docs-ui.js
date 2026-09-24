const pages = [...document.querySelectorAll('article')];
const search = document.querySelector('#search');
const status = document.querySelector('#search-status');
function showPage() {
  const id = location.hash.slice(1);
  const target = document.getElementById(id);
  const page =
    (id === 'content' ? pages.find((item) => !item.hidden) : undefined) ??
    target?.closest('article') ??
    pages.find((item) => item.id === id) ??
    pages[0];
  for (const item of pages) item.hidden = item !== page;
  for (const link of document.querySelectorAll('[data-page]')) {
    if (link.dataset.page === page.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  for (const toc of document.querySelectorAll('[data-toc]'))
    toc.hidden = toc.dataset.toc !== page.id;
  const index = pages.indexOf(page);
  for (const [selector, neighbour, label] of [
    ['#previous', pages[index - 1], 'Previous: '],
    ['#next', pages[index + 1], 'Next: '],
  ]) {
    const link = document.querySelector(selector);
    link.hidden = !neighbour;
    if (neighbour) {
      link.href = '#' + neighbour.id;
      link.textContent = label + neighbour.dataset.title;
    }
  }
  document.title = page.dataset.title + ' | SafeStripe';
  if (target && target !== page) target.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}
search.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  let count = 0;
  for (const page of pages) {
    const matches = !query || page.textContent.toLowerCase().includes(query);
    document.querySelector('[data-page="' + page.id + '"]').hidden = !matches;
    if (matches) count++;
  }
  for (const group of document.querySelectorAll('.nav-group'))
    group.hidden = ![...group.querySelectorAll('a')].some((link) => !link.hidden);
  status.textContent = query
    ? count + ' matching guides'
    : pages.length + ' guides · available offline';
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    search.focus();
  }
  if (event.key === 'Escape' && document.activeElement === search) {
    search.value = '';
    search.dispatchEvent(new Event('input'));
    search.blur();
  }
});
document.querySelector('#print').addEventListener('click', () => window.print());
window.addEventListener('hashchange', showPage);
showPage();

function activateTab(group, choice, focus = false) {
  const buttons = [...group.querySelectorAll('[role="tab"]')];
  const selected = buttons.find((button) => button.dataset.choice === choice) ?? buttons[0];
  for (const button of buttons) {
    const active = button === selected;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
  }
  if (focus) selected.focus();
}
const tabGroups = [...document.querySelectorAll('[data-tabs]')];
for (const group of tabGroups) {
  let saved;
  try {
    saved = localStorage.getItem('safestripe-docs-' + group.dataset.tabs);
  } catch {
    /* Offline/privacy mode. */
  }
  activateTab(group, saved);
  for (const button of group.querySelectorAll('[role="tab"]')) {
    button.addEventListener('click', () => {
      for (const other of tabGroups.filter((item) => item.dataset.tabs === group.dataset.tabs))
        activateTab(other, button.dataset.choice);
      try {
        localStorage.setItem('safestripe-docs-' + group.dataset.tabs, button.dataset.choice);
      } catch {
        /* Optional preference only. */
      }
    });
    button.addEventListener('keydown', (event) => {
      const buttons = [...group.querySelectorAll('[role="tab"]')];
      const index = buttons.indexOf(button);
      const next = {
        ArrowRight: (index + 1) % buttons.length,
        ArrowLeft: (index - 1 + buttons.length) % buttons.length,
        Home: 0,
        End: buttons.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].click();
      buttons[next].focus();
    });
  }
}
for (const button of document.querySelectorAll('.copy-code'))
  button.addEventListener('click', async () => {
    const block = button.closest('.code-block');
    const status = block.querySelector('.copy-status');
    try {
      await navigator.clipboard.writeText(block.querySelector('code').textContent);
      button.textContent = 'Copied';
      status.textContent = 'Code copied to clipboard';
      setTimeout(() => {
        button.textContent = 'Copy';
        status.textContent = '';
      }, 2000);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(block.querySelector('code'));
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Code selected. Press Command+C or Control+C to copy.';
    }
  });
