# Invite your first three developers

Start with people you can contact individually: a former colleague, a developer from a community you already participate in, or someone who has discussed a Stripe integration with you. Ask for a short usability test. The goal is to learn where the integration breaks or the documentation loses them.

Choose three different perspectives:

| Person      | Useful background                    | What you want to learn                                                          |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| Developer 1 | Node.js or Express backend work      | Can they configure storage and follow the saved payment state?                  |
| Developer 2 | Next.js or SaaS product work         | Can they understand the server/client boundary and create their first checkout? |
| Developer 3 | Stripe Billing or payment operations | Do the retry, webhook and receipt semantics match their expectations?           |

These are selection criteria, not existing testers or endorsements. If you only know one suitable developer, ask that person whether they can introduce you to another. Personal introductions are enough for this first round.

## Send this invitation individually

> Hey [Name], could you help me test SafeStripe? It's a Node.js library I've been working on for durable Stripe operations and webhook processing.
>
> I'm looking for three developers to spend about 20 minutes trying to get one checkout and its verified receipt working from the docs. It's an evaluation preview, so I'd like honest feedback on confusing instructions, errors and anything you'd need before considering it for a project.
>
> Demo: https://israel-oduguwa.github.io/SafeStripe/demo/
>
> Quickstart: https://israel-oduguwa.github.io/SafeStripe/get-started/
>
> Would you be willing to try it this week? You can stop wherever you get stuck; that feedback is useful too.

Replace the name and adjust the opening to fit your relationship. Ask first; send the longer test instructions after they accept. Do not describe the person as a user, contributor or customer until they actually participate.

## Give each tester the same task

1. Set aside 20 minutes and start a timer when opening the quickstart. Choose its hosted sandbox or application path; record which one you chose.
2. Try to reach one successful checkout with its verified, saved receipt. Use a disposable Stripe sandbox and enter test credentials only through the documented configuration. Do not send credentials or customer data in feedback.
3. If you reach the receipt, inspect the saved order. If time allows, follow the documented duplicate-replay check using your own sandbox event. The film's credit mistake is an illustration; its receipt result is a retained real test. Do not replay somebody else's Stripe event.
4. Record the time to the first receipt, or the exact step where you stopped. Do not spend the whole session investigating a blocker.
5. Give the maintainer the feedback below. If something failed, open a [first-integration issue](https://github.com/Israel-oduguwa/SafeStripe/issues/new?template=first-integration.yml).

For application setup, use your own app and authorization policy. The hosted sandbox provides Firestore and test records for evaluation; it does not prove a production application's security or capacity. Neither path needs Docker merely to give feedback.

## Ask five questions

1. Which path and stack did you try?
2. How many minutes did it take to reach the receipt, or where did you stop?
3. What instruction or error was hardest to understand?
4. What did you expect SafeStripe to do differently?
5. Would you consider another integration test? What would you need first?

Let testers try the guide before explaining it to them. Record help you gave separately; an assisted completion is not an independent onboarding result. Get permission before attributing feedback, quoting a person or publishing a case study.

## Track the results

Copy `EARLY-ADOPTERS.example.csv` to `EARLY-ADOPTERS.local.csv` before filling it in. The local filename is ignored by Git. Fill real observations only, and keep private contact details out of issues; the repository includes only an empty template. A blank time means the receipt was not reached, not zero minutes.

Create genuine issues for repeat blockers. Prioritize problems that stop a payment, misrepresent a saved state, expose credentials, or leave the tester unable to understand the next step. Fix and rerun those steps before expanding features.

If you do not hear back, send one short follow-up after a few days: “Just checking whether you had a chance to try the guide. No problem if you're busy; I'd still appreciate knowing which part you'd test first.”
