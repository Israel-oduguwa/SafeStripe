# Try SafeStripe

Start with one paid checkout and its saved receipt. You do not need to explore every billing feature to find out whether the library fits your application.

## Try it in the browser

The [online sandbox](https://safestripe-demo.vercel.app/) runs Express, the published `safestripe@0.3.0` package and Cloud Firestore. There is nothing to install.

1. Open a dedicated Stripe sandbox and copy its test secret and matching publishable key. Enter keys only in **Connect sandbox**, never in a public issue or recording. A test secret still grants access to that sandbox's data and settings.
2. Connect and let automatic setup create the test customer, prices and signed webhook destination. If setup stops, use **Resume setup** in the same workspace. Do not create another workspace to retry an interrupted setup.
3. Choose **Hosted checkout** and open the payment page. Use `4242 4242 4242 4242`, a future expiry and any valid three-digit CVC. These are [Stripe test card details](https://docs.stripe.com/testing), not a real card.
4. Return to the workspace. Wait for the payment checks and **verified receipt**. A redirect or a connected badge alone does not establish payment.
5. Use **Your test records and cleanup** in the connection dialog when finished. Financial history remains visible in Stripe; cleanup is not an erasure of a financial record.

The demo creates real records in your Stripe sandbox. It accepts test keys only. Separate Stripe products can require account configuration or additional key permissions; automatic setup does not enable Connect, Identity, Tax or every payment method.

## Install it in your own application

Use Node.js 22.19 or newer. Start in a new application folder:

```bash
npm install safestripe@0.3.0
```

The Stripe server SDK installs with SafeStripe. Install only the storage driver and framework your application uses:

| Application choice | Add to your installation |
| --- | --- |
| Local SQLite | No separate database driver |
| PostgreSQL | `npm install pg` |
| MongoDB replica set | `npm install mongodb` |
| Cloud Firestore | `npm install @google-cloud/firestore` |
| Express | `npm install express express-rate-limit` |
| Next.js | Use your existing Next.js application |
| React payment form | Follow the optional browser dependencies in [Payment UI](17-payment-ui.md) |

Follow [Getting started](11-getting-started.md) for the client and storage configuration, then [Framework integration](16-frameworks.md) for your routes and worker. Your application supplies authentication, customer ownership and server-approved prices. Do not copy an unrestricted authorization function into a deployed billing endpoint.

## Run the complete local example

For a working website, webhook endpoint and worker together, follow [Make your first payment](03-quickstart.md). Its Express and Next.js examples share the same local workflow and use a SQLite file by default. No Docker or database server is required.

This is a repository tutorial with example tooling. Installing the library in a separate application uses the normal `npm install` command above; consumers do not need the repository's `npm ci --ignore-scripts` command.

## What to check before adopting it

- A retry keeps its operation ID and immutable terms.
- A paid checkout reaches a signed, persisted webhook and one committed receipt.
- A failed payment does not grant access.
- Your chosen database and worker deployment pass your integration's recovery tests.

Read [the recorded lifecycle results](30-payment-lifecycle.md), [the reliability contracts](24-reliability-contracts.md) and [release readiness](28-release-readiness.md). The current release is an evaluation preview. Twelve verified sandbox journeys do not establish every company's payment policy, security posture or production capacity.

The onboarding target is five minutes to a first verified receipt once prerequisites are available. Independent timed runs have not yet established that target. If you get stuck, [report the exact step](https://github.com/Israel-oduguwa/SafeStripe/issues/new/choose), the version and what you expected. Leave keys and private account details out of the report.
