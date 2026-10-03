# Stripe idempotency is not the same as an idempotent payment system

A customer asks for a refund. Your server sends the request. Stripe accepts it. Before the response reaches your server, the connection closes.

Your logs say the request failed. The customer's money may already be on its way back. Sending a new refund with a new identity can make the mistake worse.

This is the point where a payment integration becomes a state-management problem.

## Keep the intent when the answer disappears

Give the refund a business identity before making the request. For example, `refund:order-842:approval-17` identifies one approved refund. A browser retry, another server process and a restarted worker must all use that identity and the same approved amount.

SafeStripe records the operation in your database and derives its Stripe idempotency key from its scope, tenant, operation ID and operation kind. A fingerprint detects changed parameters. After a successful write, it retains the Stripe resource ID; a later replay retrieves that resource.

If the response disappears, the operation remains recoverable. Retrying uses the original key. It does not guess that a timeout means nothing happened.

This depends on retaining the local record. It also has a deadline: Stripe can prune idempotency keys after at least 24 hours. SafeStripe's automatic recovery window is shorter. An unresolved operation outside that window needs reconciliation, not an automatic write with a fresh key. See [Stripe's idempotency contract](https://docs.stripe.com/api/idempotent_requests) and [operation identity](adr/005-operation-identity.md).

## A webhook answers a different question

Stripe can notify your application after the browser leaves. That event is evidence about remote state, but its delivery is not a promise that your fulfillment ran once.

The same event can arrive several times. Two different events can also describe the same business outcome. Deduplicating only `evt_…` therefore solves delivery duplication, not duplicate fulfillment.

SafeStripe verifies the original signed bytes and durably admits an accepted event before acknowledging it. A worker then claims it with a lease. If the process disappears, another worker can recover it after expiry. An ownership token prevents the old worker from committing as if it still owned the job.

The handler still needs a business key such as `fulfill:order-842`. Use that key for an effect guard, even if multiple event types can reach the same handler.

## Put the local decision in one transaction

Suppose fulfillment grants a subscription entitlement and sends a receipt. Sending the receipt during the database transaction creates a dangerous gap: the email service can accept the message before the database rolls back.

Instead, the transaction writes the entitlement, records the effect key and adds a receipt intent to the outbox. Those local records commit together. A dispatcher sends the message afterward.

This boundary covers records written through the same SafeStripe storage transaction. It does not automatically absorb arbitrary application writes made through a different ORM, database or transaction.

## The outbox cannot promise one delivery

The dispatcher has the same ambiguous-response problem as the refund endpoint. A recipient can accept a receipt and lose its acknowledgment. Retrying is necessary to avoid losing the message, but it can deliver it twice.

The recipient must durably deduplicate by the supplied idempotency key. SafeStripe provides at-least-once delivery. It does not turn an arbitrary HTTP endpoint into an exactly-once recipient.

## Test the gaps, not just the successful response

The [process failure suite](https://github.com/Israel-oduguwa/SafeStripe/blob/main/tests/chaos/recovery.test.ts) starts actual child processes and kills them at explicit checkpoints: after a claim, during an uncommitted effect transaction and after a simulated recipient commits. The assertions inspect stored fulfillment, effect and outbox counts after recovery. They do not stop at a successful HTTP response.

The [optional sandbox suite](https://github.com/Israel-oduguwa/SafeStripe/blob/main/scripts/stripe-e2e.ts) sends a real customer write through the Stripe SDK, deliberately discards its successful HTTP response, and retries the same operation. It then checks the remote customer count. This suite requires a dedicated sandbox; its existence does not mean it has been run. Consult the [verification record](../VERIFICATION.md) for actual evidence.

These layers have distinct identities and responsibilities:

| Layer | Stable identity | Protects against |
| --- | --- | --- |
| Stripe operation | Business operation ID plus account/tenant scope | Repeating a remote mutation after an uncertain result |
| Webhook inbox | Event ID plus account scope | Processing repeated delivery as new work |
| Local effect | Business outcome key | Different events repeating one local outcome |
| Outbox recipient | Delivery idempotency key | Repeated delivery repeating a downstream effect |

Good operational practice keeps these identities visible without logging secrets or sensitive payloads. When something fails, an operator should be able to find the intent, the remote resource, the event and the local decision—and know which one is still uncertain.
