# Add a payment form

Use hosted Checkout for the shortest integration. Stripe supplies the page, payment fields and supported payment methods. Your app creates a Session and redirects to its URL.

Use `SafeCheckout` when the payment form belongs inside your own React or Next.js page. It supplies the Stripe provider, Payment Element, submit button, loading state, duplicate-click guard and result message. You can place an order summary inside it and customize its appearance.

## Create a custom Checkout Session

On your authenticated server endpoint, use the same order validation and binding as the [framework guide](16-frameworks.md), with `uiMode: 'custom'`:

```ts
const session = await billing.createCheckout(actor, {
  customerId: order.stripeCustomerId,
  mode: 'payment',
  uiMode: 'custom',
  items: [{ priceId: order.stripePriceId, quantity: order.quantity }],
  reference: order.id,
});

await bindCheckout(order, session.id);
return Response.json(
  { id: session.id, clientSecret: session.client_secret },
  { headers: { 'Cache-Control': 'no-store' } },
);
```

The server fixes `return_url` from your configured origin. It does not allow browser-controlled redirect destinations or payment-method overrides. A hosted Session and a custom Session are different operation inputs; use a new order/action identity if you deliberately start a different flow.

A Checkout client secret is intended for the authorized customer's payment form. Do not put it in logs, analytics, query strings, public HTML caches or another customer's response. It is different from your account's secret API key.

## Wrap your order summary

The following client component receives a Session from your authenticated endpoint or an authenticated, uncached server page. It never receives the account secret key.

```tsx
'use client';

import { SafeCheckout } from '@israeloduguwa/safestripe/react';

export function OrderPayment({ session }: {
  session: { id: string; clientSecret: string };
}) {
  return (
    <SafeCheckout
      key={session.id}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      clientSecret={session.clientSecret}
      buttonLabel="Pay for my order"
      appearance={{
        theme: 'stripe',
        variables: {
          colorPrimary: '#635bff',
          borderRadius: '12px',
          fontFamily: 'system-ui, sans-serif',
        },
      }}
    >
      <div>
        <p>YOUR ORDER</p>
        <h2>Workshop ticket</h2>
        <p>Your payment is confirmed by our server before delivery.</p>
      </div>
    </SafeCheckout>
  );
}
```

The wrapper displays your children above the secure payment form. It does not turn ordinary HTML inputs into Stripe inputs. Card details are collected inside Stripe's hosted fields, which keeps them out of your server and application event handlers. Stripe.js is loaded from Stripe through its official loader. [Stripe React reference](https://docs.stripe.com/sdks/stripejs-react).

In an Express application with a React frontend, use the same component. Pass your build tool's publishable-key variable as `publishableKey`; `NEXT_PUBLIC_` is a Next.js convention, not a Stripe requirement. A plain Express application without React should start with hosted Checkout.

## What the component handles

| Behavior | What happens |
| --- | --- |
| Form initialization | Loads Stripe.js and initializes the custom Checkout provider |
| Payment methods | Renders Stripe's Payment Element with an accordion layout |
| Double-click | An immediate ref guard prevents overlapping confirmation calls |
| Validation or decline | Displays the message returned by Stripe's confirmation result |
| Redirect method / authentication | Stripe manages the required flow using the server-configured return URL |
| Successful submission | Shows a confirmation-in-progress message and invokes optional `onComplete` |
| New Session | Supply `key={session.id}` to remount the provider |

The component uses Checkout Sessions with Stripe's `CheckoutElementsProvider`; it does not create a PaymentIntent from the browser. Dynamic payment methods remain controlled by Stripe and your account configuration.

## Customize the container

Use `className` or `style` to change the outer card. Use `appearance` for the Stripe fields. They are separate because Stripe fields are isolated from your document's CSS.

```tsx
<SafeCheckout
  key={session.id}
  publishableKey={publishableKey}
  clientSecret={session.clientSecret}
  className="checkout-card"
  style={{ maxWidth: 560, boxShadow: 'none' }}
  appearance={{
    theme: 'night',
    variables: { colorPrimary: '#a5b4fc', borderRadius: '8px' },
  }}
  buttonLabel="Subscribe securely"
/>
```

The default outer card is light; set its background and text color too when choosing a dark field theme. `buttonLabel` changes the submit label. The current component does not expose every Stripe field or the entire Checkout UI: use the official React Stripe components directly if you need advanced shipping, tax-ID, contact or express-wallet layouts. SafeStripe's server and storage APIs still apply.

## Fulfill through the server

`onComplete` is for UI updates. It is not authority to send a product, grant subscription access or record revenue. The browser can close before it fires, and a client-side callback is not a trusted payment record.

Show a pending screen and query an authenticated order-status endpoint. The webhook worker should verify the Session's current payment state and authorized terms, then update your stored order. Asynchronous payment methods can complete later. Handle the relevant success and failure events for the methods you offer.

## Test before deployment

Test loading, a valid sandbox payment, decline, authentication, a duplicate click, browser refresh, redirect return and an interrupted webhook worker. Test keyboard focus, visible labels and screen-reader announcements in your application. A unit test or successful build cannot replace a real browser payment test with your account's enabled methods.

The [Next.js example](../examples/nextjs/app/checkout-form.tsx) includes an authenticated fetch and a complete local payment form. The [local quickstart](03-quickstart.md) explains how to run it.
