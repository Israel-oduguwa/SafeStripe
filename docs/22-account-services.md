# Payment surfaces and Stripe account services

Installing a package does not enable every Stripe product. Some features are API operations; others are settings or services managed by your Stripe account. This page separates the two so you know what to test.

## Choose a customer-facing payment surface

| Surface | Use it for | SafeStripe support |
| --- | --- | --- |
| Hosted Checkout | Most checkout and signup flows | `createCheckout` |
| Payment Element backed by custom Checkout | A payment form styled within your application | `createCheckout({ uiMode: 'custom' })` + `SafeCheckout` |
| Hosted payment-method setup | Collect consent and save a method for later | `createSetupCheckout` |
| Custom payment-method setup | A custom Stripe.js setup interface | `createSetupIntent`; your UI confirms the returned client secret |
| Reusable Payment Link | A public product purchase link | `createPaymentLink` |
| Pricing Table | Stripe-hosted plan selection embedded in a page | Create in Stripe; use its generated embed |
| Customer Portal | Billing details, invoices, plan changes | `createPortalSession`; configure allowed features in Stripe |

Stripe decides which enabled payment methods are eligible for the country, currency, device and transaction. SafeStripe does not guarantee that every wallet or local payment method will appear. Its helpers omit a hard-coded card-only payment-method list. Never collect raw card data in your Express or Next.js API.

For saved methods, a created SetupIntent is only the first step. Confirm it through Stripe's UI, follow consent requirements and handle authentication when it is later used. A saved method does not guarantee a future off-session payment will succeed. See [save and reuse payment methods](https://docs.stripe.com/payments/save-and-reuse).

A Payment Link is reusable and is not tied to one application's authenticated customer. Provide a separate fulfillment policy for its signed checkout events. Do not reuse the demo's fixed-customer order verifier for arbitrary Payment Link or Pricing Table purchases.

## Marketplace recipient setup

The new helper supports an **Accounts v2 recipient** model. The platform takes payment and accepts fee and loss responsibility; a seller receives transfers. That is one Connect architecture, not a universal default for every platform.

```ts
const seller = await billing.createMarketplaceAccount(actor, {
  email: approvedSeller.email,
  country: approvedSeller.country,
  displayName: approvedSeller.name,
});
```

The helper requests a recipient's Stripe balance transfer capability, uses Express dashboard access and assigns fees/losses to the platform. Persist the account ID in your verified seller mapping. Do not let a browser select a destination account.

```ts
const link = await billing.createOnboardingLink(actor, {
  accountId: savedSeller.stripeAccountId,
});
```

Return the onboarding URL only to the authenticated seller with `Cache-Control: no-store`. It is ephemeral and can be single-use. Implement `/connect/refresh` to authenticate the seller and generate a new link; `/connect/return` should retrieve current account state. A redirect is not proof of completed onboarding.

Before a transfer, SafeStripe checks the v2 recipient transfer capability, the source charge's paid state, currency, mode and unrefunded amount.

```ts
const transfer = await billing.createTransfer(actor, {
  accountId: allocation.sellerAccountId,
  chargeId: allocation.chargeId,
  amount: allocation.amountMinor,
  currency: allocation.currency,
  group: order.id,
});
```

This is **separate charges and transfers**. Retain a platform share by transferring less than the charge. The helper does not set `application_fee_amount`. A transfer is not a bank payout. Check [Stripe's transfer guide](https://docs.stripe.com/connect/separate-charges-and-transfers) for regional and balance constraints.

If funds must return from a seller, use a separately approved `reverseTransfer`. Refunding the customer and reversing the seller transfer are distinct actions. Record both in your financial ledger and reconcile them. The library does not create reserves, resolve negative balances, submit dispute evidence or manage payout timing.

For platforms where independent sellers accept direct payments, evaluate the merchant configuration and direct-charge model. This release's account-creation helper does not create that configuration. It also does not implement v2 customer-account billing for charging connected accounts themselves.

Include Stripe's onboarding, account management and notification banner components in a production seller dashboard. They help sellers satisfy changing requirements. **Accounts v2 thin events require a separate verified receiver and handler**; the existing SafeStripe webhook receiver is for the pinned v1 snapshot event contract. Do not send thin events to it and expect them to work. See [Accounts v2](https://docs.stripe.com/connect/accounts-v2).

## Revenue recovery

Configure Smart Retries, customer emails and final retry outcomes in Stripe Billing. SafeStripe's operation retries deal with uncertain API requests; they are not card-payment retries or a dunning strategy.

Handle `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.paid` and relevant subscription events. Retrieve the current resource before updating your projection, because events can arrive late or out of order. Commit access decisions and outgoing-message intents together. Decide your grace period explicitly.

Card account updates happen through Stripe and participating networks. There is no wrapper setting that guarantees an issuer will update a card. Test failure and recovery using sandbox payment methods and test clocks. See [Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries).

## Tax setup and verification

```ts
const readiness = await billing.inspectTaxSetup(actor);
```

This read-only helper returns the settings status, up to 100 active registration IDs and a pagination flag. It does not register a business, pick jurisdictions or prove that a particular transaction will collect tax.

For Checkout, `automaticTax: true` checks basic settings/registration prerequisites before creation, asks for a billing address and updates the existing customer's address from the session. Your authorizer must approve that behavior. The current helper does not expose Connect tax-liability selection; use a reviewed integration for that case.

A zero tax result can be correct. Check the calculation's taxability reason, product tax code, customer location and applicable registration. An active registration somewhere does not prove coverage everywhere. Discuss registration obligations with your tax adviser, then record confirmed registrations in the correct Stripe environment. Sandbox registrations do not configure live mode. Follow [Stripe Tax setup](https://docs.stripe.com/tax/set-up) and [testing](https://docs.stripe.com/tax/testing).

Collecting tax is also separate from filing returns. Do not describe a successful Checkout tax calculation as end-to-end tax compliance.

## Radar, disputes and Identity

Radar rules and risk decisions are configured in Stripe. Use Checkout or Stripe's secure payment fields, verify webhook signatures, restrict API keys and test blocked/challenged payments. A wrapper cannot eliminate fraud or chargebacks.

Identity session creation is available when the Stripe account has access:

```ts
const verification = await billing.createIdentitySession(actor, {
  reference: savedUser.id,
});
```

Authorize the user reference, return the hosted URL only to that user and avoid storing the URL or client secret in logs. Do not collect government-document images in your application to pass them through this helper. Session creation does not mean verification succeeded. Implement verified, requires-input and canceled status handling plus a retention policy before relying on verification. Use [Stripe's Identity test options](https://docs.stripe.com/identity/testing) in a sandbox.

Dispute evidence needs a reviewed operator workflow. This release does not auto-submit evidence, create Radar rules or guarantee compliance with identity-verification requirements.

## Revenue Recognition and financial reporting

Revenue Recognition is a Stripe account product. Your finance team must review service periods, recognition rules and adjustments. The operational metrics helper in [Revenue metrics](23-revenue-metrics.md) does not calculate recognized revenue, profit, fees, bank settlement or taxes.

For accounts receivable, build aging from open invoices and their remaining amounts/due dates, separating currencies. Handle partial payments, void invoices, credit notes and offline-payment evidence. Use the existing balance-transaction importer and reconciliation helpers for settlement data, not the MRR calculator.

## Readiness for a large deployment

This release has automated unit, SDK-request and storage tests. It has not demonstrated a million-user deployment or passed an independent security audit. A test workspace is not evidence of production capacity.

Before serving a large account:

- Load-test the chosen shared database with realistic tenant distribution, worker concurrency and retained operation history.
- Measure queue age, retry rates, Firestore reads/writes, contention and Stripe rate-limit responses.
- Use a durable usage ledger, bounded ingestion workers and account-wide backpressure. The default in-process gate is not a fleet-wide limiter.
- Run restore/replay exercises, secret rotation, entitlement reconciliation and financial period-close checks.
- Verify each enabled Stripe product and payment method in a sandbox, then complete controlled live acceptance.
- Provide tenant isolation, application authentication, seller/price ownership, approval limits, audit retention and support procedures.

See [Enterprise integration](19-enterprise.md) for deployment responsibilities. SafeStripe reduces repeated billing infrastructure; it does not remove the work of operating your business.
