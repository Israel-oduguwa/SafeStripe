# Human-data tasks, recordings, and evaluation rubrics

## What makes a useful task

A realistic task gives a goal, a starting state, constraints, and observable acceptance criteria. It leaves enough judgment to test competence without hiding facts the operator needs. A task that says only “manage Stripe” is too vague. A task that dictates every click measures instruction copying more than operational judgment.

Separate the **task prompt** shown to the operator from the **reference outcome** and **rubric** used by reviewers. Build the rubric from a verified workflow in the assigned environment. The examples here are proposed sandbox tasks; do not claim they are ground truth from an account session that has not been performed.

After you complete a lab, replace each fixture alias with the actual created ID and observed state. A reviewer should be able to tell which claims came from the prompt, which came from the recording, and which remain inferred.

## Task prompt schema

```json
{
  "task_id": "refund-partial-001",
  "environment": "dedicated sandbox name and account ID",
  "goal": "Issue the approved partial refund and verify it",
  "inputs": { "payment_id": "fixture payment ID", "currency": "usd", "amount_minor": 1000 },
  "constraints": ["Do not refund any other payment", "Do not contact the customer"],
  "preconditions": ["Original payment succeeded", "At least 1000 minor units remain refundable"],
  "expected_evidence": ["Original payment identity", "Refund ID and actual status", "Cumulative refunded amount"],
  "stop_conditions": ["Wrong account", "Open dispute", "Prior execution found", "Insufficient refundable balance"]
}
```

The environment and identifiers must be supplied before an evaluated run. A free-form customer name without a stable identifier creates avoidable ambiguity. Amounts must include currency and units.

## Prompt A :  Partial refund with prior activity

“In the assigned sandbox, inspect payment `PAYMENT_A` for `CUSTOMER_A`. The original amount is USD 49.00 and an earlier approved refund of USD 5.00 is already recorded. Issue one additional refund of USD 10.00 for the service adjustment in case `CASE_A`, using the requested-by-customer reason. Do not cancel the subscription, alter the customer, send a message, or refund another payment. If a dispute is open, the previous refund differs from the stated amount, or case `CASE_A` is already completed, stop and report the discrepancy. Record the refund ID, actual status, and cumulative refunded amount.”

Reference outcome after valid setup: one new USD 10.00 refund against the intended payment; cumulative refunds USD 15.00; remaining unrefunded amount USD 34.00. “Remaining unrefunded” is not a claim about pending funds or availability. Status may require follow-up rather than immediate success.

| Criterion | Points | Full-credit evidence | Partial / zero guidance |
| --- | ---: | --- | --- |
| Context and identity | 15 | Correct sandbox, payment and customer IDs visible | 5 if context inferred; 0 for wrong object |
| Preconditions | 20 | Checks prior USD 5 refund, available remainder, dispute and duplicate case | 10 for incomplete check; 0 if knowingly bypassed |
| Mutation accuracy | 30 | Exactly one USD 10 refund with correct reason | 15 if correct amount but reason missing; 0 for wrong amount/object |
| Verification | 20 | Refund ID, status and cumulative USD 15 shown | 10 if ID shown without totals; 0 for banner-only claim |
| Evidence quality | 10 | Readable trace with timestamps and no sensitive leakage | 5 for one missing reference; 0 if unusable |
| Handoff | 5 | Concise result and pending issues accurately stated | 0 for unsupported completion claim |

Critical failures override the score: live-mode mutation in a sandbox task, wrong-payment refund, duplicate refund, unauthorized customer contact, or exposure of real payment credentials. If preconditions fail and the operator correctly stops, evaluate the diagnostic path; do not penalize them for refusing an invalid mutation.

## Prompt B :  Draft invoice with a deliberate ambiguity

“Create a draft invoice for `CUSTOMER_B` for two units of the approved consulting Price at USD 75.00 each, due in 14 days. Do not finalize, email, or collect payment. The task fixture specifies no tax or discount. Before saving, inspect the draft total. If current account settings add tax or an unexpected item, report the mismatch and keep the invoice unfinalized. Record the invoice ID and draft status.”

Reviewer emphasis: customer identity, exact Price and quantity, detection of automatic settings, correct draft boundary, and no unauthorized sending. Give 25 points for correct items/currency, 20 for correct customer, 20 for draft-only behavior, 15 for due terms, 10 for detecting/reporting deviations, and 10 for evidence. Finalizing or sending when explicitly prohibited is a critical task-boundary failure.

Do not award full credit to an invoice totaling USD 150 if it accidentally uses two unrelated USD 75 items. Judge record structure as well as totals.

## Prompt C :  Cancellation timing

“For `SUBSCRIPTION_A`, schedule cancellation at the end of the currently agreed service period. Preserve access until the effective boundary specified by the contract. Do not cancel immediately and do not create a refund. Verify the subscription ID, current Price, cancellation instruction, and effective date. If a schedule or pending update conflicts with this instruction, stop and report it.”

Rubric: identity and current contract 20, conflict inspection 20, correct scheduling 30, resulting state and date verification 20, evidence/handoff 10. Immediate cancellation or an unrequested refund is a critical failure. Showing `active` after scheduling is not inherently wrong; the operator must explain scheduled versus terminal state.

## Prompt D :  Repair a payment/order mismatch

“Order `ORDER_A` remains pending even though its assigned sandbox Checkout Session shows paid. Inspect the related webhook delivery and SafeStripe inbox. Identify the cause. Apply the provided approved repair procedure, then verify exactly one fulfillment effect. Do not create another payment, alter payment amounts, delete event records, or manually mark the order paid outside the reviewed business handler.”

Rubric: establishes payment/order relation 20, diagnoses delivery versus processing failure 25, follows approved repair path 25, proves one effect and correct order state 20, records limitations 10. A second financial charge, deleted audit evidence, or unreviewed manual fulfillment is a critical failure.

The reference solution depends on the injected failure. Examples include a stopped worker, a missing session binding, or an intentionally failed handler. Do not use the same reference answer for all three.

## Prompt E :  Read-only dispute review

“Review `DISPUTE_A` in the assigned sandbox. Identify its amount, currency, deadline, reason, and linked payment. Use the supplied synthetic fulfillment and communication records to prepare an evidence inventory organized by relevance to the stated reason. Do not submit evidence, accept the dispute, issue a refund, or contact the customer. Explain any missing facts.”

Rubric: case/deadline identity 20, factual evidence linkage 30, completeness and missing-fact analysis 20, preservation of the read-only boundary 20, clear handoff 10. Fabricated evidence or unauthorized submission fails the task regardless of presentation quality.

## Screen-recording procedure

Before recording, sign in with the approved role and choose the correct sandbox. Close unrelated tabs and chat applications, hide password managers, disable notification previews, and prepare synthetic fixtures. Keep API-key screens, environment files, terminals that display secrets, personal email, and unrelated customer records out of the capture area.

Use the operating system's approved recorder or the project's designated tool. Record one application window when possible. Use readable zoom and a resolution that makes IDs, amounts and statuses legible. Run a short audio/video check. Narrate decisions: “I am verifying the refundable balance before submitting” is more useful than narrating every cursor movement.

Suggested sequence:

1. Show task ID, account context and intended outcome.
2. Inspect starting records and preconditions.
3. Explain the decision before the irreversible step.
4. Perform the authorized action once.
5. Re-open the result and verify identity, amount, currency and state.
6. Summarize completed work, pending state and evidence references.

Pause only according to project rules. If a pause conceals relevant setup or changes, disclose it. Do not edit a recording to make an error look like it never happened. Corrections can demonstrate competence when honestly explained.

Review the entire clip before sharing. If a secret appears, stop distribution and follow the incident procedure; blurring a later export does not revoke an exposed key. Use the approved private storage, access group and retention period. Share only where the project directs. A publicly accessible video link is not an appropriate default for financial workflow evidence.

## Evidence manifest

```text
Run ID: refund-partial-001-run-02
Prompt version: 1.1
Rubric version: 1.0
Account / sandbox: supplied fixture context
Recording: approved private artifact reference
00:00–00:25  Task and environment
00:25–01:10  Payment identity and prior refund
01:10–01:45  Preconditions and authorized action
01:45–02:20  Refund ID, actual status and cumulative amount
Observed deviations: none / factual description
Unverified claims: bank arrival, if no bank evidence exists
Reviewer: assigned reviewer ID
```

Actual timestamps must come from the completed recording. Do not prefill them as if the run occurred.

## Reviewer calibration and disagreement

Have two reviewers independently score a small calibration set before evaluating many runs. Compare criterion-level disagreements, not just overall scores. A 90 and a 70 may differ because one reviewer assumed that “refund submitted” means “refund succeeded.” Fix the criterion or evidence requirement rather than averaging an unresolved semantic disagreement.

For each finding, record the claim, evidence timestamp, criterion, severity and rationale. Distinguish a task defect, a system failure, an operator error and missing evidence. Avoid inferring competence, intent or honesty from speed, accent, narration style, or unrelated personal information.

Use a four-state outcome where appropriate: **completed**, **correctly stopped**, **failed**, or **insufficient evidence**. A safe and accurate stop can be the correct outcome of an invalid task. “Insufficient evidence” means the reviewer cannot establish the fact, not that the operator necessarily performed it incorrectly.

## Capstone

Set up a fictional customer, one-time payment, recurring subscription, manual invoice, partial refund and failed renewal. Inject a duplicate webhook and one missing local mapping. Ask the operator to complete the authorized operations, diagnose the mismatch, record a walkthrough and create a new prompt/rubric based on their actual run.

Acceptance requires correct financial identities and totals, no duplicated effect, clear pending states, an evidence manifest, and a rubric another reviewer can apply. The engineer must also explain the lost-response recovery path and the production controls still required. This capstone connects practical Stripe operations, engineering reliability and human-data evaluation in one inspectable artifact.
