import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';

let state, field, mounts, optionsSeen, confirmations, stripeLoads;
const stripe = {};
mock.module('@stripe/stripe-js', {
  namedExports: {
    loadStripe: async () => {
      stripeLoads++;
      return stripe;
    },
  },
});
mock.module('@stripe/react-stripe-js/checkout', {
  namedExports: {
    CheckoutElementsProvider: ({ children, options }) => {
      useEffect(() => {
        mounts++;
        optionsSeen.push(options);
      }, []);
      return children;
    },
    useCheckoutElements: () => state,
    PaymentElement: (props) => {
      field = props;
      return React.createElement('div', { 'data-field': '' });
    },
  },
});
const { SafeCheckout } = await import('../../src/react/index.tsx');

async function fixture(t, initial = { type: 'loading' }, observer = () => {}) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  state = initial;
  field = undefined;
  mounts = 0;
  optionsSeen = [];
  confirmations = 0;
  stripeLoads = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const container = document.getElementById('root');
  const root = createRoot(container);
  const changes = [];
  const props = {
    publishableKey: 'pk_test_offlineFixture',
    clientSecret: 'cs_test_offline_secret_fixture',
    onLoadStateChange: (value) => {
      changes.push(value);
      observer(value);
    },
  };
  const render = async (extra = {}) =>
    act(async () => {
      root.render(React.createElement(SafeCheckout, { ...props, ...extra }));
    });
  t.after(async () => {
    await act(async () => root.unmount());
    t.mock.timers.reset();
  });
  await render();
  return {
    container,
    changes,
    render,
    tick: async () => act(async () => t.mock.timers.tick(30000)),
    click: async (label) =>
      act(async () => {
        const element = [...container.querySelectorAll('button')].find(
          (el) => el.textContent === label,
        );
        assert.ok(element);
        element.click();
      }),
    submit: async () =>
      act(async () => {
        container
          .querySelector('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      }),
  };
}
const success = (confirm) => ({
  type: 'success',
  checkout: {
    confirm: async (...args) => {
      confirmations++;
      return confirm(...args);
    },
  },
});

test('a stalled provider offers retry with identical client secret and no mutation', async (t) => {
  const f = await fixture(t);
  assert.match(f.container.textContent, /Loading secure payment form/);
  await f.tick();
  assert.match(f.container.textContent, /taking longer than expected/);
  assert.deepEqual(f.changes, ['loading', 'slow']);
  await f.click('Retry payment form');
  assert.equal(mounts, 2);
  assert.equal(stripeLoads, 1);
  assert.equal(confirmations, 0);
  assert.equal(optionsSeen[0].clientSecret, optionsSeen[1].clientSecret);
  assert.equal(f.changes.at(-1), 'loading');
});

test('late arrival remains usable and only actual field readiness enables payment', async (t) => {
  const f = await fixture(t);
  await f.tick();
  state = success(async () => ({ type: 'error', error: { message: 'Declined' } }));
  await f.render();
  assert.equal(f.container.querySelector('button[type="submit"]').disabled, true);
  await f.submit();
  assert.equal(confirmations, 0);
  await act(async () => field.onReady());
  assert.equal(f.container.querySelector('button[type="submit"]').disabled, false);
  assert.equal(f.changes.at(-1), 'ready');
  await f.tick();
  assert.doesNotMatch(f.container.textContent, /taking longer/);
});

test('SDK and field failures expose recovery without leaking upstream secrets', async (t) => {
  const f = await fixture(t, { type: 'error', error: { message: 'private client secret' } });
  assert.match(f.container.textContent, /Unable to load/);
  assert.doesNotMatch(f.container.textContent, /private client secret/);
  state = success(async () => assert.fail('payment must not run'));
  await f.click('Retry payment form');
  await act(async () => field.onLoadError({ error: { message: 'private client secret' } }));
  assert.equal(f.changes.at(-1), 'error');
  assert.equal(f.container.querySelector('button[type="submit"]').disabled, true);
  await f.submit();
  assert.equal(confirmations, 0);
});

test('double submission confirms once and a throwing consumer callback cannot undo success', async (t) => {
  let resolve,
    completed = 0;
  const f = await fixture(
    t,
    success(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
    () => {
      throw new Error('consumer observer');
    },
  );
  await f.render({
    onComplete: () => {
      completed++;
      throw new Error('consumer notification');
    },
  });
  await act(async () => field.onReady());
  await f.submit();
  await f.submit();
  assert.equal(confirmations, 1);
  await act(async () => resolve({ type: 'success', session: { id: 'cs_test_offline' } }));
  assert.equal(completed, 1);
  assert.match(f.container.textContent, /Payment submitted/);
  assert.equal(f.container.querySelector('button[type="submit"]').disabled, true);
  await f.submit();
  assert.equal(confirmations, 1);
});

test('a decline permits another confirmation, while an ambiguous result asks for status', async (t) => {
  const f = await fixture(
    t,
    success(async () => ({ type: 'error', error: { message: 'Your card was declined.' } })),
  );
  await act(async () => field.onReady());
  await f.submit();
  assert.match(f.container.textContent, /Your card was declined/);
  assert.equal(f.container.querySelector('button[type="submit"]').disabled, false);
  state = success(async () => {
    throw new Error('network');
  });
  await f.render();
  await f.submit();
  assert.equal(confirmations, 2);
  assert.match(f.container.textContent, /Check your order status before trying again/);
});

test('consumer re-renders do not remount the provider or restart loading forever', async (t) => {
  const f = await fixture(t);
  await f.render({ buttonLabel: 'Buy' });
  await f.render({ buttonLabel: 'Subscribe' });
  await f.tick();
  assert.equal(mounts, 1);
  assert.deepEqual(f.changes, ['loading', 'slow']);
});
