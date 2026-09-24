# Getting started

Run a small payment-processing demo without connecting to Stripe. Then choose a framework and complete a sandbox payment.

## What you need

- A computer with Node.js 22 or later installed. Node.js runs JavaScript outside a browser; npm, its package manager, comes with it.
- The `SafeStripe` folder from this project, extracted from the source archive or cloned from its repository.
- A terminal. On macOS, open Terminal. On Windows, use PowerShell or a terminal in your editor.

You do not need Docker, a database account, a Stripe key, or a card for this first exercise.

## 1. Open the project folder

In your editor, open `SafeStripe`, then open the editor's terminal. Its working folder should contain `package.json`. You can also type `cd ` in your terminal and drag the folder into it on macOS, then press Enter.

Check that Node.js and npm are available:

```sh
node --version
npm --version
```

The first command should show `v22` or a later major version. If the command is not found, install Node.js using the instructions on the [Node.js download page](https://nodejs.org/en/download), then reopen the terminal.

A command block is something you type in a terminal. A JavaScript or TypeScript block is code you save in a file. The guides name the file when they ask you to create one.

## 2. Install dependencies

From the project folder, run:

```sh
npm ci
```

This downloads the versions listed in `package-lock.json`. It can take a few minutes on the first run. Use `npm ci` when working on the source checkout; use `npm install` when adding SafeStripe to another application.

## 3. Run the demo

```sh
npm run demo
```

The program creates a temporary database, makes signed test events, and processes them. The expected result is:

| Record | Expected result | Meaning |
| --- | --- | --- |
| Completed webhook jobs | 2 | Two different events were handled |
| Fulfillment effects | 1 | The order was fulfilled once |
| Pending receipt intents | 1 | One request to send a receipt was stored |

It also sends a duplicate delivery of one event. The inbox accepts that event only once.

Nothing is charged or sent. The receipt is a database record waiting for a delivery service. This distinction matters in a real application: saving an intention to send an email and actually sending it are separate steps.

The demo exits when it finishes. Its embedded database is temporary. You can rerun it without cleanup.

## 4. Run the checks

```sh
npm run check
```

This checks the TypeScript code, runs the automated tests, and creates the compiled library in `dist`. The summary should show zero failed tests. Tests include duplicate requests, changed inputs, lost worker leases, transaction rollback, signature verification, and request encoding.

If a command fails, read the first error above the summary. A download error usually points to connectivity or registry access. A Node.js version error means your terminal is using a different Node installation. A busy port or permission error can affect the local HTTP fixture tests; these tests start temporary servers on loopback addresses.

## 5. Take a test payment

Continue with [Run a sandbox payment](03-quickstart.md). That guide adds PostgreSQL, a Stripe sandbox, a fictional customer, and a test price. You will start either Express or Next.js, create a Checkout Session, and verify the resulting order.

Choose Express if you already use an Express API or want a small standalone server. Choose Next.js if your application already uses its App Router. Both routes use the same payment library and worker.

## Understand the payment flow

1. Your application decides which customer and price belong to an order.
2. SafeStripe records the operation and asks Stripe to create a Checkout Session.
3. The customer completes the hosted Checkout page.
4. Stripe sends a signed event to your webhook endpoint.
5. The endpoint verifies the message and saves it before responding.
6. A worker verifies the payment and updates the order in a database transaction.

The browser's success page is a receipt for navigation. The worker is responsible for fulfillment. Customers may close a tab, and delayed payment methods may finish after the browser has left.

## If you only need the Stripe Dashboard

Start with [Stripe objects and state](01-objects-and-state.md), then complete the [operations workbook](05-operations-workbook.md). Those exercises use Stripe's Dashboard and explain how to verify outcomes. You do not need to install this library to practice invoice or refund workflows.

## Next steps

To add the library to an existing application, read [Installation and integration](12-integration.md). To understand why the database and worker are needed, read [What SafeStripe solves](13-what-safestripe-solves.md).
