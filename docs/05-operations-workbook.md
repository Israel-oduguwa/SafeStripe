# Stripe payment-operations workbook

## Working standard

Use this procedure for every assigned task: read the instruction, confirm the account and sandbox/live context, identify the exact records, inspect prerequisites, perform only authorized changes, verify the resulting state, and record evidence. If instructions conflict with an observed financial fact, document the conflict rather than improvising another financial action.

The labs below are synthetic exercises for a dedicated sandbox. They have not been performed in your Stripe account. Replace fixture labels with object IDs created during setup. Dashboard navigation can change; use the relevant resource search and detail pages. Never use real customer contact details for training data.

Maintain a run sheet:

| Field | Value to record |
| --- | --- |
| Task and run ID | Unique identifier for this attempt |
| Operator and reviewer | Named authorized participants |
| Account and environment | Exact account ID and sandbox label |
| Input identities | Customer, payment, invoice, subscription, refund or dispute IDs |
| Authorized change | Amount, currency, dates, reason, scope and any approval reference |
| Starting state | Facts inspected before action |
| Actions | Actual sequence, including deviations and failed attempts |
| Result | Object ID, observed status, important totals and timestamps |
| Evidence | Recording timestamps and approved screenshots or exports |
| Exceptions | Pending outcomes, unavailable controls, conflicts, escalation owner |

## Lab 1 :  Create and verify a customer

**Scenario:** A fictional organization, “Northstar Training Ltd,” needs a billing customer. Use `billing+northstar@example.invalid` for a non-deliverable synthetic address. No notification is required.

**Before acting:** Search for an existing fixture by the assigned run label. If it exists, inspect its ID and task history rather than creating another customer. Confirm the account is the sandbox and that the name/address supplied by the task are synthetic.

**Procedure:** Open Customers, choose the create/add action, and enter the approved name and email. Add only task-specified fields. Save, reopen the customer, and verify the persisted details. Record its `cus_...` ID as `CUSTOMER_A` in the run sheet. If correcting a field, describe the before/after value and verify after saving.

**Evidence:** Environment indicator, customer ID, name, email, and final detail view. Mask unrelated customers.

**Pass condition:** One intended customer exists with the exact supplied fields and no unintended payment or subscription. A success banner alone is insufficient.

**Recovery:** If you created a duplicate, identify both records and ask the project owner which to retain under the task's correction policy. Do not delete a customer with attached financial history merely to tidy the list. The library's corresponding action is `createCustomer`; application mapping remains a separate responsibility.

## Lab 2 :  Complete a one-time sandbox payment

**Scenario:** `CUSTOMER_A` buys one approved training product at USD 49.00. Use a one-time Price created for this fixture.

**Before acting:** Verify the Price ID, currency, recurring/one-time classification, quantity, and task policy for tax. If the price is tax-inclusive or a discount is present, the expected amount must reflect the approved setup. A flat 49.00 expectation assumes neither additional tax nor discounts.

**Procedure:** Create Checkout through the SafeStripe demo or the task's approved Stripe payment surface. Confirm the displayed item and total. Complete the sandbox flow with an appropriate test method. Return to the Dashboard and inspect the actual payment record. Follow linked Checkout/PaymentIntent/Charge resources where available. Then inspect the application's order state after webhook processing.

**Evidence:** Session or payment ID, customer linkage, USD 49.00 expected total, payment status, and one fulfillment result. Do not record real card information or secrets.

**Pass condition:** A successful payment belongs to the intended customer and exactly one business fulfillment exists. A redirect with no verified payment is a failure; an asynchronous payment still processing is pending, not automatically failed.

**Recovery:** If the browser disconnects, retrieve the original session or inspect the existing payment. Do not create a new payment merely because the success page did not load. See [Stripe test scenarios](https://docs.stripe.com/testing).

## Lab 3 :  Create and finalize a manual invoice

**Scenario:** Invoice `CUSTOMER_A` for two consulting units at USD 75.00 each, due in 14 days. Fixture tax and discounts are disabled unless the task explicitly says otherwise. The draft subtotal is USD 150.00.

**Before acting:** Confirm the customer ID and billing terms. Decide whether the authorized task ends at draft, finalization, or delivery. These are separate actions. In a real project, sending an invoice or attempting collection must be explicitly in scope.

**Procedure:** Open Billing → Invoices or find Invoices via search. Create a draft for `CUSTOMER_A`, add the approved item and quantity, set the due terms and currency, and review the line items. Save the draft and record its `in_...` ID. If finalization is authorized, review the immutable billing fields again, finalize, and verify the resulting status and due date. Deliver only through the approved channel and only if requested.

**Evidence:** Customer ID, invoice ID, line descriptions, quantities, subtotal, tax, discount, total, collection method, and actual due date. For a task ending at draft, prove it remains draft.

**Pass condition:** Correct terms and arithmetic, no unrelated pending items swept into the invoice, and exactly the requested final state.

**Recovery:** Correct a draft before finalization. For a finalized error, use the appropriate invoice correction, void, or credit-note workflow under the project policy. Do not mark an unpaid invoice paid to make it look complete. SafeStripe's API sequence is create draft → add explicitly attached items → finalize, using one stable operation ID per step. Stripe's [Dashboard invoicing guide](https://docs.stripe.com/invoicing/dashboard) describes the relevant controls.

## Lab 4 :  Diagnose and recover a failed invoice

**Scenario:** A sandbox renewal has failed. Determine whether it requires a new payment method, customer authentication, or investigation.

**Before acting:** Read the invoice ID, subscription ID, attempt history, and current status. Confirm that a later successful payment has not already resolved the case.

**Procedure:** Open the invoice and associated payment information. Record the observed failure or action-required condition without copying sensitive request payloads. Inspect configured automatic retry behavior. Use the task's approved test method or customer recovery flow. After recovery, retrieve the invoice again and inspect subscription status and application access independently.

**Evidence:** Before and after invoice status, relevant attempt timestamps, recovery action, and current customer-facing state. If no recovery was authorized, provide a diagnosis and recommended next action only.

**Pass condition:** The outcome is correctly classified, no duplicate collection was initiated, and access matches the approved policy. A pending authentication requirement is reported as pending.

**Recovery:** Do not run a competing manual retry loop alongside Billing's configured recovery. For recurring-state practice, use [Billing simulations and test clocks](https://docs.stripe.com/billing/testing/test-clocks). Wait for the simulation to finish advancing before interpreting its resulting objects.

## Lab 5 :  Create a subscription and inspect its lifecycle

**Scenario:** `CUSTOMER_A` subscribes to an approved monthly training plan. Choose whether the fixture has a trial before beginning.

**Procedure:** Confirm the recurring Price ID, interval, currency, quantity, collection method and any trial terms. Create the subscription through approved Checkout or Billing controls. Record `sub_...`, the initial invoice, the payment state, and the next billing boundary shown by the current API/UI. Verify the application projection after the lifecycle webhook arrives.

**Evidence:** Customer, Price, quantity, trial/billing dates, status, initial invoice, and application entitlement decision.

**Pass condition:** The expected subscription exists once, the initial payment/trial state is accurately explained, and access is not granted solely because a subscription object was created.

**Recovery:** An incomplete initial payment needs its existing confirmation/recovery flow. Do not repeatedly create subscriptions. If a terminal incomplete-expired subscription must be replaced, first reconcile the original obligation and use an explicit new attempt.

## Lab 6 :  Preview and apply a seat change

**Scenario:** Move from five to eight seats with the approved immediate proration policy.

**Procedure:** Inspect current subscription items and pending updates. Record the change proposal and proration timestamp. Generate a preview; note debit/credit, taxes, discounts, total, currency, and collection policy. Apply only the approved proposal. Retrieve the subscription and resulting invoice. If authentication is required, record the pending update and recovery requirement rather than claiming the upgrade is paid.

**Evidence:** Original quantity, proposed quantity, quote details, accepted timestamp, resulting invoice, final/pending subscription state.

**Pass condition:** No duplicate item was added accidentally, the correct item was changed, and the resulting bill is explained. The same proration timestamp was used where the API workflow supports it.

**Recovery:** If another operator changed the subscription meanwhile, stop and produce a new proposal. Do not silently overwrite the competing change. See [proration guidance](https://docs.stripe.com/billing/subscriptions/prorations).

## Lab 7 :  Schedule cancellation

**Scenario:** Cancel renewal at the end of the paid service period; do not end service immediately and do not refund automatically.

**Procedure:** Inspect subscription and schedule state. Select the end-of-period cancellation policy. Review the effective date and any pending invoice implications. Save and re-open the subscription. Verify that the cancellation instruction is scheduled and that the current service entitlement remains consistent with the task.

**Evidence:** Subscription ID, current status, cancellation flag/effective boundary, and customer access policy.

**Pass condition:** Renewal is scheduled to stop at the intended boundary, with no unintended immediate termination or refund.

**Recovery:** If immediate cancellation was selected accidentally, document it and follow the project recovery procedure. Do not assert that setting a flag back will revive a terminal canceled subscription. Stripe's [cancellation guide](https://docs.stripe.com/billing/subscriptions/cancel) covers available workflows.

## Lab 8 :  Issue and verify a partial refund

**Scenario:** Return USD 10.00 against the USD 49.00 payment from Lab 2 because of a requested service adjustment. This is a synthetic sandbox refund authorized by the exercise.

**Before acting:** Verify the exact payment and customer, successful captured amount, earlier refunds, refundable remainder, and whether a dispute is open. Check that this task's refund-request ID has not already been completed.

**Procedure:** Open the payment detail and choose its refund action. Enter the approved partial amount and reason. Review the confirmation before submitting. Record the refund's `re_...` ID, status, amount and currency. Re-open the original payment and verify cumulative refunded amount.

**Evidence:** Original payment ID, prior refunded amount, the new USD 10.00 refund, cumulative total, reason and actual refund status.

**Pass condition:** Exactly the authorized refund was requested against the correct payment. The operator distinguishes pending from succeeded. A bank-arrival claim requires additional evidence; the Dashboard action alone cannot establish it.

**Recovery:** If the result is unclear, retrieve the refund or inspect the payment before trying again. Another refund ID is another financial instruction. Refer to [refunds](https://docs.stripe.com/refunds).

## Lab 9 :  Triage a dispute and prepare evidence

**Scenario:** A sandbox dispute fixture concerns a training order. Prepare a review package; submission is a separate action unless explicitly authorized.

**Procedure:** Open Disputes and the assigned case. Record the reason, amount, currency, response deadline and linked payment. Check fulfillment/customer communication evidence from the authorized fixture. Match each evidence item to the dispute reason. Preview the response where available, identify missing facts, and save a draft only if that is the assigned outcome.

**Evidence:** Case ID, deadline with timezone, linked payment, relevant evidence inventory, draft/submitted distinction and any missing requirements. Use only permitted synthetic files.

**Pass condition:** Correct case, complete reason-specific analysis, truthful evidence, and no unauthorized submission or acceptance of the dispute.

**Recovery:** Missing evidence should be documented, not invented. Escalate close deadlines through the approved project process. Do not issue an independent refund without understanding dispute-specific restrictions and potential double reimbursement. See [responding to disputes](https://docs.stripe.com/disputes/responding).

## Lab 10 :  Reconcile transactions and a payout

**Scenario:** Explain the movement from a small set of sandbox payments and refunds into the Stripe balance. If the sandbox does not provide an authentic bank/payout artifact for the exercise, mark bank settlement as unverified.

**Procedure:** Choose a fixed reporting window, timezone and currency. Export the appropriate authorized transaction report or inspect Balance Transactions. Match each payment, refund, fee and adjustment by identity. Compute net movement and compare with the application records. For an eligible payout exercise, use the payout's reconciliation details and compare the actual bank evidence supplied by the task.

**Evidence:** Report settings, transaction IDs, gross/fee/net, separate currency totals, payout identity where relevant, and an exception list.

**Pass condition:** Every included row is matched or explained; cutoff and currency differences are explicit. A total that happens to match while rows differ is not sufficient.

**Recovery:** Investigate missing rows, duplicated imports, timezone boundaries, pending availability, currency conversion and adjustments. Preserve the original export. Do not overwrite a discrepancy just to balance a spreadsheet. Use [Balance](https://docs.stripe.com/reports/balance) and [Payout reconciliation](https://docs.stripe.com/reports/payout-reconciliation) documentation to select the right report.

## Lab 11 :  Investigate a failed webhook delivery

**Scenario:** A payment is successful but the application order remains pending.

**Procedure:** Inspect the relevant event in Workbench. Confirm its endpoint, attempt time, HTTP response and environment. Check whether SafeStripe admitted it, whether a worker claimed it, and whether it is pending, done, or dead. Read stable error codes and look up the related operation/order mapping. Fix the actual cause, then replay through the authorized mechanism. Verify one business effect and the resulting order state.

**Evidence:** Event ID, delivery status, inbox state, root cause, reviewed replay action, business-effect identity and final order status.

**Pass condition:** The repair changes the intended business record exactly once. An HTTP 200 without a completed effect is not considered a finished repair.

**Recovery:** For a bad signature, fix body handling or secret selection. For an unknown order mapping, reconcile the API operation. For an account mismatch, repair routing; do not bypass scope checks. See [Workbench event delivery inspection](https://docs.stripe.com/webhooks#view-event-deliveries).

## Independent work and remote handoff

At the beginning of a remote session, record the task version and acceptance criteria. During execution, keep a short decision log. At the end, provide a concise handoff: completed changes, observed final states, evidence references, unresolved issues and next owner. Do not promise completion for a task whose underlying state is still pending.

Use the minimum permissions needed for each assignment. Separate setup fixtures from the evaluated run. If the project changes its rubric mid-run, preserve the original run evidence and record which criteria changed rather than retroactively describing different work.
