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
for (const region of document.querySelectorAll('[data-film]')) {
  const video = region.querySelector('video');
  const play = region.querySelector('[data-film-play]');
  const wait = region.querySelector('[data-film-wait]');
  const status = region.querySelector('[data-film-status]');
  let deadline;
  let pending = false;
  const busy = (value) => {
    pending = value;
    wait.hidden = !value;
    play.disabled = value;
    play.hidden = value || !video.paused;
    region.setAttribute('aria-busy', String(value));
    clearTimeout(deadline);
    if (value)
      deadline = setTimeout(() => {
        busy(false);
        status.textContent = 'Playback is taking a moment. Retry or download the MP4 below.';
      }, 15000);
  };
  const start = async (seekTo) => {
    if (pending) return;
    busy(true);
    status.textContent = 'Preparing the demo…';
    try {
      await video.play();
      // Native playback may restart at zero; seek only after that startup completes.
      if (typeof seekTo === 'number') video.currentTime = seekTo;
    } catch {
      busy(false);
      status.textContent = 'Use the video controls or download the MP4 to watch.';
    }
  };
  play.hidden = false;
  play.addEventListener('click', () => start());
  video.addEventListener('waiting', () => busy(true));
  video.addEventListener('playing', () => {
    busy(false);
    status.textContent = 'Sandbox test replay · timing edited · sound optional';
  });
  for (const event of ['pause', 'ended'])
    video.addEventListener(event, () => {
      busy(false);
      status.textContent = video.ended
        ? 'Replay the demo or try the sandbox.'
        : 'Paused · use the controls or a chapter to continue';
    });
  video.addEventListener('error', () => {
    busy(false);
    status.textContent =
      'This browser could not load the video. Download the MP4 or read the transcript.';
  });
  for (const chapter of region.querySelectorAll('[data-film-seek]'))
    chapter.addEventListener('click', () => {
      start(Number(chapter.dataset.filmSeek));
    });
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
