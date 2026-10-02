# Recurring revenue metrics

Use two customer snapshots to answer a practical question: how did recurring revenue change during this period?

The calculator is a pure function. It does not contact Stripe, read Firestore, infer customer history or require a secret key. It is available through the main server entry point and the browser-safe `safestripe/metrics` entry point.

```ts
import { calculateRevenueMetrics } from 'safestripe/metrics';

const report = calculateRevenueMetrics({
  currency: 'usd',
  start: [
    { customerId: 'acme', monthlyAmount: 10000 },
    { customerId: 'birch', monthlyAmount: 5000 },
    { customerId: 'cedar', monthlyAmount: 5000 },
  ],
  end: [
    { customerId: 'acme', monthlyAmount: 15000 },
    { customerId: 'birch', monthlyAmount: 3000 },
    { customerId: 'delta', monthlyAmount: 10000 },
  ],
});
```

Amounts are integer **monthly minor units**, not dollars. In USD, `10000` means $100 per month. Each customer appears once in each snapshot. Combine their subscription items first. Use one currency per call; no exchange-rate conversion is performed.

## Read the result

The sample starts with $200 MRR and ends with $280:

| Movement | Amount | Why |
| --- | --- | --- |
| Starting MRR | $200 | Acme $100 + Birch $50 + Cedar $50 |
| New MRR | +$100 | Delta joins |
| Expansion | +$50 | Acme grows |
| Contraction | −$20 | Birch reduces its plan |
| Churned MRR | −$50 | Cedar leaves |
| Ending MRR | $280 | Starting amount plus movements |

The annual run rate is $3,360. Net revenue retention is 90%; gross revenue retention is 65%. One of the three starting paying customers leaves, giving customer churn of one-third. New customers do not improve the retention ratios.

## Definitions

| Result field | Definition |
| --- | --- |
| `startingMrr`, `endingMrr` | Sum of monthly amounts in each snapshot |
| `annualRunRate` | Ending MRR × 12 |
| `newMrr` | Ending amount from customers with no positive starting amount |
| `expansionMrr` | Increase for customers positive in both snapshots |
| `contractionMrr` | Decrease for customers positive in both snapshots |
| `churnedMrr` | Starting amount for customers with no positive ending amount |
| `netMrrChange` | Ending MRR − starting MRR |
| `netRevenueRetention` | (Starting MRR + expansion − contraction − churn) ÷ starting MRR |
| `grossRevenueRetention` | (Starting MRR − contraction − churn) ÷ starting MRR |
| `customerChurnRate` | Customers lost ÷ starting paying customers |
| `averageRevenuePerCustomer` | Ending MRR ÷ ending paying customers, rounded to a minor unit |

Ratios are fractions: `0.9` means 90%. A missing denominator returns `null`. Free customers do not count as paying customers. A customer absent at the start but present at the end counts as new, even if an older historical record would describe them as reactivated. Two snapshots cannot distinguish that history.

## Build comparable snapshots

Choose a consistent policy before calculating:

1. Take complete snapshots at known period boundaries in the same timezone.
2. Include committed fixed recurring charges after recurring discounts and before tax.
3. Exclude one-off fees, trials and uncertain usage forecasts.
4. Decide whether past-due subscriptions remain in MRR during a grace period and apply that rule at both boundaries.
5. Sum each customer's qualifying items, keeping currencies separate.
6. Save the snapshot time, policy version and source IDs with your report.

Do not pass just the first page of a Stripe subscription list. Missing customers would be interpreted as churn. For a large deployment, build snapshots from a reconciled reporting projection or warehouse rather than synchronously scanning every subscription in an HTTP request.

## Normalize a fixed recurring amount

```ts
import { monthlyRecurringAmount } from 'safestripe/metrics';

const monthlyAmount = monthlyRecurringAmount({
  amount: 120000,
  interval: 'year',
  intervalCount: 1,
});
// 10000: $100 per month from a $1,200 annual charge.
```

The function supports days, weeks, months and years. It uses 365 days or 52 weeks per year for normalization, then divides by twelve. Those are reporting conventions, not a calculation of the next calendar invoice. It rounds half up to a minor unit. For multiple items, aggregate comparable amounts before rounding where possible and document any residual rounding in your reporting policy.

All amount arithmetic uses integers internally. Invalid, negative, fractional or unsafe integer amounts are rejected, as are duplicate customer IDs and results outside JavaScript's safe integer range. A call supports up to 100,000 customer rows per snapshot; this is an input bound, not a throughput benchmark. Larger businesses should calculate partitioned, auditable aggregates in their reporting system.

## What this report cannot tell you

MRR is not cash collected, recognized accounting revenue, profit, lifetime value or a churn prediction. The calculation has no information about payment processor fees, refunds, credits, cost of service, exchange rates or your accounting policy. Those need separate inputs and reports.

The test workspace includes an editable calculator using the same package function. It labels the sample inputs clearly and runs entirely in the browser. It does not pretend to display your connected account's revenue.
