const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(tab) {
  for (const item of tabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  }
}
for (const tab of tabs) {
  tab.addEventListener('click', () => select(tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? tabs[0]
        : event.key === 'End'
          ? tabs.at(-1)
          : tabs[1 - tabs.indexOf(tab)];
    select(next);
    next.focus();
  });
}
document.getElementById('copy-install').addEventListener('click', async () => {
  if (document.getElementById('copy-install').disabled) return;
  try {
    await navigator.clipboard.writeText(document.getElementById('install-command').textContent);
    document.getElementById('copy-status').textContent = 'Installation command copied.';
  } catch {
    document.getElementById('copy-status').textContent =
      'Select the installation command above to copy it.';
  }
});
