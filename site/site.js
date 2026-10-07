for (const group of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...group.querySelectorAll('[role="tab"]')];
  function select(tab) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.setAttribute('tabindex', active ? '0' : '-1');
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next =
        event.key === 'Home'
          ? tabs[0]
          : event.key === 'End'
            ? tabs.at(-1)
            : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
  if (tabs.length) select(tabs[0]);
}
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const label = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Copying…';
    const value = document.getElementById(button.dataset.copy).textContent;
    const status =
      button.closest('.code-card')?.querySelector('[role="status"]') ||
      document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(value);
      if (status) status.textContent = 'Copied to clipboard.';
    } catch {
      if (status) status.textContent = 'Select the command above to copy it.';
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = label;
    }
  });
}
const menuButton = document.querySelector('.menu-toggle');
const header = document.querySelector('.site-header');
if (menuButton && header) {
  header.dataset.enhanced = 'true';
  menuButton.hidden = false;
  const setMenu = (open) => {
    header.dataset.menuOpen = String(open);
    menuButton.setAttribute('aria-expanded', String(open));
  };
  setMenu(false);
  menuButton.addEventListener('click', () =>
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true'),
  );
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menuButton.focus();
    }
  });
  for (const link of header.querySelectorAll('nav a'))
    link.addEventListener('click', () => setMenu(false));
}
