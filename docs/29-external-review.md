# Review an integration before adopting it

Independent review is still open. The following exercises give an outside developer something concrete to test and a useful way to report findings. A maintainer running these exercises is a self-review, not an independent audit.

## Try the quickstart without coaching

Use a new folder and a dedicated Stripe sandbox with synthetic customer details. Follow [Make your first payment](03-quickstart.md), starting a timer before installation. While the unscoped release is unavailable, use the prepared package archive described there; record the archive's checksum. Do not substitute the older scoped 0.2.0 package.

Try to reach a paid hosted Checkout, a verified webhook and one committed receipt. Record each place you needed help, including an unclear instruction. Save the time to first successful receipt. Run the same operation again and confirm that its Stripe identity stays the same. The five-minute onboarding target has not been established by outside testing yet.

| Item | What to record |
| --- | --- |
| Environment | OS, Node, package version and storage adapter |
| Installation source | Registry version, or archive checksum and source commit |
| Elapsed time | Install, configuration, Checkout, webhook and first receipt |
| Blocker | Step, expected result, observed result and help needed |
| Recovery | Whether a retry reused the existing operation or needed a deliberate new action |

Do not include API keys, client secrets, customer data, private dashboard links or service-account files in a public report. Replace object IDs with consistent labels when a finding does not require them.

## Review the reliability boundaries

Use disposable storage and test keys. Start with [the five contracts](24-reliability-contracts.md), [architecture](02-distributed-architecture.md) and [threat model](07-security-and-scale.md).

| Exercise | Expected result | Where to start |
| --- | --- | --- |
| Retry one refund after losing its response | Same operation and immutable amount; no second refund | `scripts/stripe-e2e.ts` |
| Change the terms under an existing operation ID | Conflict before another mutation | `tests/operations.test.ts` and `tests/storage.test.ts` |
| Request another tenant's customer or payment | Application authorizer denies it; no Stripe write | `src/transport.ts` and your application policy |
| Supply altered bytes or an expired webhook signature | Rejected before admission | `tests/webhooks.test.ts` |
| Stop storage before webhook admission | No successful acknowledgment | `tests/webhooks.test.ts` and framework adapter tests |
| Kill a worker after claim and before commit | Recoverable lease; one committed effect and outbox intent | `tests/chaos/recovery.test.ts` |
| Reuse the expired worker's ownership token | Stale completion rejected | Storage conformance tests |
| Deliver different events for the same order | One effect under the shared business key | PostgreSQL contention case in the chaos suite |
| Accept an outbox message, then lose the response | Delivery may repeat; receiver's durable guard applies once | Outbox SIGKILL case in the chaos suite |
| Run two migration processes | One immutable migration history | `tests/production.test.ts` |
| Restore storage from before a remote write | Writes stay suspended until an operator reconciles the gap | Restore runbook and application operating procedure |

The library requires an application authorizer; it cannot infer ownership from a Stripe ID. External calls inside a transaction callback are unsafe because the database may retry the callback. Review the integration's code as well as the library.

## Report a result that someone can reproduce

For a documentation or usability problem, open a [GitHub issue](https://github.com/Israel-oduguwa/SafeStripe/issues). Include the version, environment, shortest reproduction, expected behavior, actual behavior and the effect on the integration. Name the verification layer: mock, local database, real Stripe test API or deployed journey.

For a vulnerability, use the private route in [SECURITY.md](https://github.com/Israel-oduguwa/SafeStripe/blob/main/SECURITY.md). Do not post an exploit containing credentials or other users' data. Keep a failing regression with a fix when possible, and retain failed benchmark observations rather than publishing only successful runs.

A useful review record names the reviewer with their consent, the revision and boundaries examined, findings, fixes and unresolved risks. No outside findings, user counts or endorsements are implied by this guide.
