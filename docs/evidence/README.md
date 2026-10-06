# Recorded evidence

These files retain observations from specific runs. They are not a certification of production readiness.

- [Stripe service report, 6 October 2026](stripe-service-2026-10-06.json): six checks against Stripe's actual test API using SDK 22.6.2 and snapshot API `2026-08-26.dahlia`. The report identifies the tested commit and records its limits. This unclaimed temporary CLI sandbox did not permit a remote account-identity read; the protected release workflow does not accept it as account-verified release evidence. No browser payment or public-network webhook was exercised by this runner.
- [Browser payment report, 6 October 2026](stripe-browser-2026-10-06.json): the actual React payment component and Stripe-hosted fields completed a fake-card payment. A server read verified the expected customer, paid status and $5.00 USD. Temporary fixtures were refunded and cleaned. This local test did not verify a public-network webhook or Firestore receipt, and it does not establish 3DS coverage or account-verified release evidence.
- [PostgreSQL measurements](../../benchmarks/README.md): three repetitions for each of one, four and eight worker lanes, with complete raw reports and the original failed warm-ups retained. This is a store benchmark, not a payment-throughput claim.

Keys, client secrets, customer payloads, account identifiers and portal URLs are excluded. Keep private provisioning manifests and diagnostic logs under ignored `artifacts/`; never attach them to public issues or releases.
