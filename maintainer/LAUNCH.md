# Launch SafeStripe with evidence

The next milestone is three outside developers completing one payment without coaching. The package, public sandbox, architecture records, failure suite and initial benchmark reports already exist. More billing features will not tell us whether a stranger can use them.

Keep the release positioned as an evaluation preview. A donation, npm download or successful sandbox run is not evidence of a company's production adoption.

## This week

| Priority | Work | Finished when |
| --- | --- | --- |
| 1 | Record the payment failure and recovery below | A short video shows the failure, the successful retry and a signed receipt without exposing credentials |
| 2 | Invite three developers to try the [onboarding guide](../docs/31-try-safestripe.md) | Each independently records time to a first receipt, blockers and whether they needed help; track findings in [issue #8](https://github.com/Israel-oduguwa/SafeStripe/issues/8) |
| 3 | Fix the repeated blockers | Reproductions become public issues; fixes have a regression check, reviewed PR and passing CI |
| 4 | Add a NestJS consumer example | It installs the registry package in a clean folder and verifies original webhook bytes, authorization and a worker; it is not presented as complete before those checks pass |
| 5 | Prepare the next patch release | Actual fixes, release notes, package checks and configured provenance/signing; [issue #6](https://github.com/Israel-oduguwa/SafeStripe/issues/6) remains open |

Ask reviewers for permission before naming them or quoting their feedback. [Independent security review](https://github.com/Israel-oduguwa/SafeStripe/issues/23) and production load/restore validation remain separate from onboarding. Do not replace these gates with the claim “ready for millions of users.”

## A 30-second recording

Use a fresh disposable sandbox workspace. Complete connection and setup **before** recording. Keep test keys, Dashboard account details and customer details out of the frame. Choose **Hosted checkout**, prefill a future expiry and test CVC, and use a neutral synthetic name. Increase text size so viewers can read the result on a phone.

| Time | Show | Say |
| --- | --- | --- |
| 0–5 seconds | The existing checkout with test card `4000 0000 0000 9995` | “This payment fails. The order must stay unpaid.” |
| 5–11 seconds | Submit; Stripe displays the decline | “A failed attempt does not fulfill the order.” |
| 11–20 seconds | In the same Checkout Session, replace the card with `4242 4242 4242 4242` and submit | “The customer retries the same checkout.” |
| 20–27 seconds | Return to SafeStripe and wait for the verified receipt | “SafeStripe processes the signed event and saves the receipt in Firestore.” |
| 27–30 seconds | Receipt and link to the public lifecycle evidence | “Inspect the result. Try it with your own sandbox.” |

Do not force the video to fit 30 seconds by concealing a slow webhook or a free-host wake-up. Trim unrelated navigation and label cuts or elapsed-time compression. Record the real attempt and keep the uncropped source privately. The 30 seconds is an editorial target, not a performance benchmark.

This demonstrates a declined card followed by successful payment. It does **not** demonstrate recovery from a lost server response or a killed worker. Do not narrate those failures over this footage.

For the backend reliability demonstration, run `npm run test:chaos` and show a real worker process killed after claim, an expired lease reclaimed, and the invariant checks. The local SQLite lane needs no Docker; PostgreSQL cases run on CI. Those are synthetic event tests. The separate [protected Stripe test](https://github.com/Israel-oduguwa/SafeStripe/blob/main/scripts/stripe-e2e.ts) loses a successful customer-create response and verifies one remote customer after replay; its refund replay is a separate test, not a lost-refund-response test. Use these descriptions accurately.

## Proof someone can inspect

| Claim | Evidence | Boundary |
| --- | --- | --- |
| Twelve selected payment lifecycle journeys passed | [Public lifecycle run](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37600727941) and [report](../docs/evidence/stripe-lifecycle-2026-10-07.json) | Stripe sandbox, installed 0.3.0, deployed Express/Firestore; bank fixtures use the SDK |
| Workers recover from process death | [Chaos suite](https://github.com/Israel-oduguwa/SafeStripe/blob/main/tests/chaos/recovery.test.ts) and [CI](https://github.com/Israel-oduguwa/SafeStripe/actions/workflows/ci.yml) | Stated storage and synthetic workloads; inspect assumptions |
| Rates and contention were measured | [Benchmark method and raw results](../benchmarks/README.md) | SQLite/PostgreSQL on recorded machines; not Stripe throughput or production capacity |
| Architecture choices are documented | [Contracts](../docs/24-reliability-contracts.md), [ADRs](../docs/adr/README.md), [runbooks](../docs/08-testing-and-runbooks.md) | At-least-once delivery requires recipient deduplication |
| A normal npm installation works | [Registry installation report](../docs/evidence/npm-registry-2026-10-06.json) | Exact published version, export/type checks; not proof of adoption |

Record npm's aggregate downloads only with the time range and package name. They include repeat installs and automation. Keep “people who tried it,” “independent reviewers” and “production adopters” separate. Do not add customer logos, endorsements or case studies until they exist and the customer agrees to publication.

## Distribute after the first fixes

Start with the website, repository and one technical article. Choose one community at a time and answer questions there. Check each community's current rules before posting. No announcement in this file has been published.

- **Hacker News:** submit a usable project to Show HN, explain its narrow problem and be available for discussion. Follow [Show HN's rules](https://news.ycombinator.com/showhn.html); do not ask people to upvote it. A small patch is not automatically a new Show HN submission.
- **Reddit:** use the relevant community's feedback or showcase thread where permitted. Lead with a failure, a reproduction and the limits of the project.
- **X and LinkedIn:** show the short recording, one engineering decision and a direct link to try it. Avoid repeating an identical announcement after every patch.
- **Dev.to:** publish the [idempotency article](../docs/26-idempotent-payment-systems.md), including the actual failure boundaries and links to the tests.
- **Discords and Stripe communities:** participate where project sharing is permitted, ask for integration feedback and stay to answer questions. Do not mass-message members or invent an official Stripe affiliation.

## Announcement drafts

### Show HN

Title: **Show HN: SafeStripe — durable Stripe operations and recoverable webhook workers**

I built SafeStripe for the work around a Stripe request: keeping an operation's identity through retries, persisting a signed webhook before acknowledging it, and recovering a worker's job after a crash.

It uses your database: PostgreSQL, MongoDB, Firestore or local SQLite. Express and Next.js examples are included. The public sandbox runs the published npm package with Firestore, and the repository contains process-kill tests, measured benchmarks and the assumptions behind each reliability contract.

This is an evaluation preview. Independent security review and production capacity testing remain open. I'd especially welcome feedback on the first-payment setup and the boundaries around authorization, effects and outbox delivery.

Try it: https://safestripe-demo.vercel.app/
Code and docs: https://github.com/Israel-oduguwa/SafeStripe

### X

A Stripe request can succeed while your server sees a timeout. Retrying safely takes more than a new HTTP request.

SafeStripe stores the operation in your database, persists verified webhooks and gives workers recoverable leases.

Evaluation preview, with public tests and measured benchmarks:
https://israel-oduguwa.github.io/SafeStripe/

### LinkedIn / Reddit feedback post

I've been building SafeStripe, a reliability layer for Stripe applications in Node.js.

The difficult part was deciding what should survive a timeout, a repeated webhook or a worker crash. The project separates operation identity, webhook admission, business-effect guards and outbox delivery. Each has a documented boundary and a test.

The sandbox now has twelve verified payment lifecycle journeys, including a decline followed by success, partial and full refunds, delayed bank outcomes and a failed subscription renewal recovered to paid. The reports also say what was not tested.

I'm looking for three developers to try the first-payment guide without help and tell me where they get stuck. It is an evaluation preview; independent security review and production capacity validation remain open.

Docs: https://israel-oduguwa.github.io/SafeStripe/
Sandbox: https://safestripe-demo.vercel.app/

## Keep releasing for a reason

Review actual feedback each week. Ship when a verified fix or meaningful documentation improvement is ready; do not change versions just to maintain a calendar. For every release, record the problem, reproduction, test, scope, migration impact and remaining limits. Share a follow-up when there is a useful result, such as a fixed race or a clearer install, rather than another generic launch post.

## Creator-page description

SafeStripe helps Node.js teams keep Stripe operations and webhook processing recoverable when requests repeat or workers stop. I maintain the library, its examples and the sandbox. If the project saves you time, buying me a coffee is a way to support testing, documentation and ongoing maintenance. SafeStripe stays free and MIT licensed.

Use the creator platform's own onboarding for payout eligibility, verification and terms. Configure the verified public profile URL in both websites before enabling the support buttons. Do not collect donation card details or payout credentials in SafeStripe.
