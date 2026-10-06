# Reliability benchmark

This harness measures the portable store's admission, effect transaction and operation contention paths. It never calls Stripe. A result describes the stated machine and workload, not capacity promised to an application.

```sh
npm ci
npm run benchmark
```

The default is local SQLite, 1,000 unique events, ten delivery attempts per event, four worker lanes in one process and three measured repetitions. A separate warm-up run is retained for diagnostics and excluded from measured rates. SQLite remains a one-process adapter: these lanes share the same driver.

For a disposable PostgreSQL database, set `CHAOS_DATABASE_URL` privately and run:

```sh
BENCH_DATABASE=postgres BENCH_EVENTS=10000 BENCH_WORKERS=8 npm run benchmark
```

The harness creates a randomly named schema and removes only that schema when finished. The connection must have schema-creation rights. Never point test tooling at a production database. Set `BENCH_LOCATION` to describe where the database runs without including hostnames or credentials.

Results include runtime/hardware, database version, connection budget, nearest-rank p50/p95/p99, CPU time, sampled RSS, operation claim contention and counts of committed effects/outbox intents. Every fulfillment must equal one; every unique event must finish; incomplete work, duplicate effects and unexplained failures fail the run. Recognized PostgreSQL serialization, deadlock or uniqueness conflicts may recover through the production loop; failed worker attempts and exhausted transaction retries remain visible in the report. Raw JSON is retained in `results/`, or the path set by `BENCH_OUTPUT`. Incomplete and failed runs write `passed: false`, retaining completed repetitions and a sanitized failure observation.

Admission is sequential and closed loop. Processing starts after admission ends, so admission-to-commit latency includes deliberate backlog build-up. Worker iteration latency records non-idle iterations. Failed claims and backoff are counted separately; total processing time includes those delays. `transactionCallbackRetries` counts callback executions after the first attempt in a transaction. Failures before a callback begins are not counted there. Database resource use, process recovery time, network ingress, real Stripe traffic and external deliveries are not measured. Use the separate process-failure suite for recovery correctness.

Record three or more runs for each configuration and keep the raw reports. Do not compare different databases or worker counts without holding event shape, duplicate ratio, runtime and infrastructure constant. Report errors alongside throughput; never remove slow or failed runs silently.

## PostgreSQL without a local database server

Open **Actions → PostgreSQL reliability benchmark → Run workflow** in GitHub. Select 1,000, 5,000 or 10,000 unique events. The workflow starts PostgreSQL 17 on the GitHub runner, measures three repetitions each with one, four and eight worker lanes, and uploads raw JSON, including failures. Your computer needs no Docker installation.

Each configuration uses a separate GitHub-hosted runner. Event shape, Node major version, duplicate ratio and the four-connection workload pool remain fixed; the host is not an identical dedicated machine. Every report records its observed hardware. Small rate differences may reflect host variability. Same-process lanes do not establish multi-process or multi-host capacity.

## First recorded baseline

The [SQLite baseline](results/sqlite-latest.json) was recorded on 3 October 2026 with Node 22.20.0, SQLite 3.50.4, a 12-logical-CPU Intel i7-9750H laptop and 16 GiB RAM. Other development work was running on the same machine; this is not a dedicated benchmark host.

| Measured run | Admission attempts/s | Committed effects/s | Duplicate effects | Worker errors |
| ------------ | -------------------: | ------------------: | ----------------: | ------------: |
| 1            |                4,767 |                 556 |                 0 |             0 |
| 2            |                4,873 |                 556 |                 0 |             0 |
| 3            |                4,916 |                 556 |                 0 |             0 |

Each run attempted 10,000 admissions for 1,000 event identities and ended with 1,000 completed jobs, 1,000 effect guards and 1,000 outbox intents. These rates describe local store calls, not payment throughput or HTTP requests. Earlier development runs were slower and were not retained as complete benchmark artifacts; this baseline does not establish a performance trend.

The report contains the parent commit, a dirty-tree marker and a SHA-256 fingerprint of the listed source inputs. The harness was first measured before its stabilization commit. Preserve those inputs when reproducing the result; do not attribute it to an unmodified parent revision.

## First PostgreSQL attempt and protocol correction

[The first matrix run](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37447449988) passed the one-lane configuration but failed the four- and eight-lane warm-ups. Both warm-ups finished all 100 jobs with 100 effects and 100 outbox intents; the harness rejected recovered failed worker attempts (two and four respectively). Those original reports are retained as `postgres-*-initial.json`.

The revised protocol still requires every fulfillment to equal one and every job to finish. It additionally counts exhausted transactions by recognized SQLSTATE, rejects unexpected transaction failures, and rejects failed worker attempts that cannot be explained by those conflicts. A recovered attempt is reported as a failure count, not converted to zero errors. Warm-up observations are retained too. This change measures recovery explicitly; it does not increase the adapter's retry budget or alter production storage code.

## PostgreSQL measurements — 6 October 2026

[The corrected matrix](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37448381177) passed all three configurations. Reports contain GitHub's tested pull-request merge revision `b2c8f9ab9312f574bea5d697fd8c0251cb303404`, corresponding to branch revision `0bced69`, and the same source-input fingerprint. Node 22.23.3 and PostgreSQL 17.11 ran on separate 4-logical-CPU, 16 GiB GitHub hosts: EPYC 9V45 for one lane; EPYC 7763 for four and eight lanes. Each used four workload connections and one schema-administration connection.

| Worker lanes | Run | Admission attempts/s | Committed effects/s | Admission p95 ms | Callback retries | Failed worker attempts | Duplicate effects |
| -----------: | --: | -------------------: | ------------------: | ---------------: | ---------------: | ---------------------: | ----------------: |
|            1 |   1 |                2,118 |                 168 |             0.69 |                0 |                      0 |                 0 |
|            1 |   2 |                2,058 |                 378 |             0.67 |                1 |                      0 |                 0 |
|            1 |   3 |                2,169 |                 306 |             0.66 |                0 |                      0 |                 0 |
|            4 |   1 |                1,035 |                 277 |             1.32 |              310 |                      0 |                 0 |
|            4 |   2 |                1,057 |                 289 |             1.28 |              287 |                      0 |                 0 |
|            4 |   3 |                1,061 |                 283 |             1.29 |              297 |                      0 |                 0 |
|            8 |   1 |                  940 |                 212 |             1.49 |              675 |                      0 |                 0 |
|            8 |   2 |                  958 |                 218 |             1.46 |              635 |                      0 |                 0 |
|            8 |   3 |                  946 |                 211 |             1.46 |              651 |                      0 |                 0 |

Each measured repetition made 10,000 admission attempts for 1,000 event identities and finished with exactly 1,000 completed jobs, effects and outbox intents. Twenty competing operation claimants produced one owner and nineteen busy results. No measured repetition had an exhausted transaction or failed worker attempt. The four- and eight-lane warm-ups each recovered three exhausted transactions and three failed worker attempts; both finished all 100 effects without duplication. These warm-ups remain in the raw reports.

Raw reports: [one lane](results/postgres-1-workers.json), [four lanes](results/postgres-4-workers.json), [eight lanes](results/postgres-8-workers.json). They retain p50/p95/p99, backlog latency, CPU time, memory, retries, contention and warm-up observations.

More worker lanes did not improve this small workload consistently. Hosts differed and transactions contended within a fixed four-connection pool. Do not use these rates as HTTP, Stripe payment or multi-host capacity claims. The useful result is correctness under the stated repetition and contention, including recovered warm-up failures. A deployment needs representative load and recovery measurements on its own database tier.
