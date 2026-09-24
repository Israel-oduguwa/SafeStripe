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
