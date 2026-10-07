// The creator owns this destination. Fail the build rather than publish a wrong payment link.
export function validateSupportUrl(value) {
  if (value === null) return null;
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !['buymeacoffee.com', 'www.buymeacoffee.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/[a-zA-Z0-9_.-]+\/?$/.test(url.pathname)
  )
    throw new Error('Support URL must be a public HTTPS Buy Me a Coffee creator profile.');
  return url.href;
}

export function supportMarkup(value) {
  const url = validateSupportUrl(value);
  if (!url) return { button: '', dialog: '' };
  return {
    button:
      '<button type="button" class="support-trigger" data-support-open aria-haspopup="dialog" aria-controls="support-dialog">Buy me a coffee</button>',
    dialog: `<dialog id="support-dialog" class="support-dialog" aria-labelledby="support-title" aria-describedby="support-description">
      <div class="support-content"><button type="button" class="support-close" data-support-close aria-label="Close support dialog" autofocus>×</button>
      <span class="support-cup" aria-hidden="true">☕</span>
      <h2 id="support-title">Help keep SafeStripe maintained.</h2>
      <p id="support-description">If SafeStripe saves you time, you can support its testing, documentation and ongoing maintenance.</p>
      <a class="support-action" data-support-link href="${url}" target="_blank" rel="noopener noreferrer">Buy me a coffee <span aria-hidden="true">↗</span></a>
      <p class="support-note">Optional, always. SafeStripe stays free and MIT licensed. Payments open on Buy Me a Coffee.</p>
      </div></dialog>`,
  };
}
