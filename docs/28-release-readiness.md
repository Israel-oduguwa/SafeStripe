# Release readiness

Reviewed 6 October 2026. SafeStripe 0.3.0 is published on npm as an evaluation preview. The public sandbox is available for evaluation. There is enough working software to run a pilot, but the evidence does not support recommending this release for unattended production payments at a large company.

## What the project does

Stripe processes payments and manages billing. Your application still needs to decide who can buy, what they owe, when to grant access, and how to recover after a server or database failure.

SafeStripe stores the history of that work in your database. It wraps selected Stripe commands, receives verified webhooks, and gives workers a recoverable queue. Within a transaction, your handler can update application state, record that a business effect happened, and schedule a downstream notification together.

For example, an online course sells a $40 enrollment:

1. Your server loads the approved order and calls SafeStripe with `checkout:order-184`.
2. SafeStripe records the operation and creates the Stripe Checkout Session with a stable idempotency key.
3. If the response disappears, the same operation can be retried with the same terms. Changing the amount under that identity is rejected.
4. After payment, the endpoint verifies and stores Stripe's webhook before acknowledging it.
5. A worker checks the stored order and payment, then commits enrollment and one receipt intent with an effect key tied to that order.
6. If the worker stops before commit, the database rolls back. Another worker can recover the job after its lease expires. A repeated event does not create another committed enrollment under the same effect key.

The email or downstream service may still receive a delivery twice. It needs its own durable deduplication keyed by the receipt identity. SafeStripe provides at-least-once outbox delivery, not a universal exactly-once network guarantee.

## Problems it saves an application team from rebuilding

| Failure                                               | SafeStripe mechanism                                                                                 | Application responsibility                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A refund succeeds remotely, but the server times out  | Durable operation identity, immutable terms, Stripe idempotency and a bounded automatic retry window | Keep the operation ID and history; investigate unresolved operations after the cutoff |
| A webhook receives HTTP 200, then the process crashes | Signature verification and database admission before acknowledgment                                  | Operate the database and worker; configure the signing secret and endpoint            |
| A worker dies while holding work                      | Expiring leases and ownership checks on completion                                                   | Monitor recovery, tune lease duration and use bounded handlers                        |
| Different events describe the same paid order         | A transactional business-effect guard                                                                | Choose the business key and validate the payment against the order                    |
| An order update commits, but its notification is lost | State, effect and outbox intent can share a database transaction                                     | Deliver the outbox and make the receiver idempotent                                   |

These failures are real integration concerns. Stripe documents duplicate delivery, retries and event ordering in its [webhook guide](https://docs.stripe.com/webhooks), and remote request replay in [Idempotent requests](https://docs.stripe.com/api/idempotent_requests). Stripe's idempotency key does not, by itself, make your enrollment, inventory, receipt or entitlement update idempotent.

SafeStripe is most useful when an application has fulfillment or billing state to coordinate. A simple hosted Payment Link with no local fulfillment may not need this library. A company with an established payment orchestration system should compare these mechanisms with its existing controls before adopting another layer.

## Current evidence

| Area                    | Observed state                                                                                                                                                                                                                                                                            | Practical limit                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public demo             | Vercel frontend, Render Express backend and Firestore workspaces are deployed                                                                                                                                                                                                             | A temporary test service, not a production payment endpoint or availability commitment                                                                                          |
| Real Stripe walkthrough | Hosted one-time and recurring Checkout produced signed webhook receipts; refund replay, portal, paid plan change and several billing records were exercised                                                                                                                               | One sandbox and selected paths; not complete lifecycle or payment-method coverage                                                                                               |
| Custom Checkout         | A fresh Stripe sandbox reproduced the rejection of `ui_mode: custom`; sending `elements` creates a usable Session                                                                                                                                                                         | A public $5 test payment completed after reopening the same Session; the signed webhook stored the paid order and Firestore receipt. Insufficient funds left another order unpaid; retrying it with a 3DS test card completed the challenge and a signed receipt. The corrected readiness/recovery component completed another public payment and signed receipt after deployment at 15:02 UTC; delayed methods remain separate checks. |
| Dedicated sandbox suite | The actual-SDK runner passed six service checks in a temporary CLI sandbox, including remote response loss and refund replay                                                                                                                                                              | Temporary sandbox account details cannot be read; account-verified protected CI and a real network webhook remain separate gates                                                |
| Failure tests           | Local processes are killed with SIGKILL; tests check effect/outbox counts, lease recovery and graceful shutdown                                                                                                                                                                           | Local SQLite results and PostgreSQL CI results are separate evidence                                                                                                            |
| CI recovery             | The twenty-process harness failure from main was corrected. Revision `a59ea98` passed [Node 22/24 and adapter checks](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37439904112) and [security checks](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37439904122) | Still require green checks on the eventual release commit; passing CI is not enterprise capacity evidence                                                                       |
| Storage adapters        | PostgreSQL, MongoDB replica sets and Firestore have transaction-facing adapters and CI conformance tests                                                                                                                                                                                  | Validate production IAM, indexes, connection budgets and backup recovery in your deployment                                                                                     |
| Benchmarks              | SQLite baseline and nine measured PostgreSQL repetitions retained zero duplicate effects; four- and eight-lane warm-ups recovered transaction failures. [Read the report](../benchmarks/README.md)                                                                                        | Store measurements on stated machines; no HTTP, payment, multi-host or enterprise capacity claim follows                                                                        |
| npm | Unscoped `safestripe@0.3.0` is public. A normal clean installation matched the reviewed archive and passed core, SQLite, framework exports, strict types and optional-peer imports | First publication has no CI provenance or verified signed release tag. Import checks do not establish connectivity or application capacity |
| GitHub and docs         | Source, license, architecture, ADRs, guides, security policy and automated workflows exist                                                                                                                                                                                                | Repository documentation and automated scans are not independent review                                                                                                         |

The [verification record](../VERIFICATION.md) retains dated results. The separate [sandbox repository](https://github.com/Israel-oduguwa/Safestripe-test-demo-website) records its browser walkthrough and deployment checks. Some billing objects were created successfully without completing their payment, renewal or tax lifecycle. Those are partial checks, not passing end-to-end scenarios.

## Required before recommending a production release

1. **Verify payment methods and loading recovery.** The public Elements form completed a $5 test payment and signed Firestore receipt at 14:42 UTC on 6 October. Its initial loading stalled and reopening the same Session recovered it. The deployed recovery fix completed another signed receipt, and saved connection restoration passed on reload. One decline and one 3DS challenge also passed. Keep the [sanitized observation](evidence/stripe-public-elements-2026-10-06.json) and test the remaining methods and failure paths required by your application.
2. **Pass CI on the release commit.** Keep the actual PostgreSQL process tests and MongoDB/Firestore conformance enabled. Investigate flaky failures; do not mark skipped provider tests as passes.
3. **Run account-verified Stripe release checks.** The temporary sandbox proved the ambiguous remote-write case and six service checks. Retain its sanitized report, then run the protected workflow using an account-verified restricted key. Complete asynchronous payment, failed renewal, retry and out-of-order cases relevant to the product being launched.
4. **Complete the release supply chain.** The npm naming transition and [clean registry check](evidence/npm-registry-2026-10-06.json) are complete. The demo transition is tracked in its repository. Configure the trusted publisher and use the [release workflow](27-release-evidence.md) for a subsequent unpublished version with a verified signed tag, provenance, SBOM and checksums. npm versions are immutable; 0.3.0 cannot be republished to add provenance.
5. **Review the security boundaries independently.** Focus on authorization, tenant isolation, credential handling, replay permissions, ownership and restore behavior. Turn findings into reproducible issues and fixes.
6. **Validate the intended production infrastructure.** Measure database contention and queue recovery with representative workloads. Test migrations, rolling deployments, Stripe rate limits, retries and database outages. Exercise backup restoration before financial writes resume. Alert on queue age, dead jobs, review-state operations and outbox failures.
7. **Run unfamiliar-developer onboarding.** Have developers follow the published quickstart without coaching. Record where they get stuck and improve the guide. Do not claim outside adoption, audits or performance that have not happened.

A company can evaluate the preview in a test environment now. A production pilot needs a named owner, selected workflows, limits, rollback and a review of the company's authorization and fulfillment code. Millions of users is a capacity target to test against; it is not a property established by the package name or architecture diagram.

## Staying connected to the public sandbox

The browser keeps an HttpOnly, Secure session cookie. Reloading or returning from Checkout uses that cookie to reopen the same workspace while its one-hour access window remains valid. Test secret keys stay encrypted on the server and are not placed in browser storage.

If the server is temporarily unreachable, choose **Retry saved connection**. The retry reads the existing workspace; it does not submit your keys or create another set of Stripe records. If setup was interrupted, resume that workspace. Missing, expired or deleted sessions return to the connection form.

Reloads do not extend the expiry. Disconnect deletes the demo workspace; Stripe test records remain in your account. The online demo does not provide permanent credential storage. Companies integrating the library manage their own long-lived credentials, authentication and database; they do not use the public visitor session as production infrastructure.

## Scope and trust

SafeStripe does not replace Stripe, application authentication, a fraud policy, tax registration, accounting, reconciliation procedures or database operations. The default request gate limits one process, not every server sharing an account. It also does not promise that every Stripe feature is available to every account.

Verification statements describe observed tests and their limits. Keep the release evidence, issue history and known limitations available when reviewing an integration.
