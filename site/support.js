(() => {
  const dialog = document.getElementById('support-dialog');
  const link = dialog?.querySelector('[data-support-link]');
  if (!dialog || !link || typeof dialog.showModal !== 'function') return;
  let opener;
  for (const button of document.querySelectorAll('[data-support-open]')) {
    button.addEventListener('click', () => {
      opener = button;
      if (!dialog.open) dialog.showModal();
    });
  }
  dialog.querySelector('[data-support-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener?.focus());
})();
