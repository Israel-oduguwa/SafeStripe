# Reliability benchmark

This harness measures the portable store's admission, effect transaction and operation contention paths. It never calls Stripe. A result describes the stated machine and workload, not capacity promised to an application.

```sh
npm ci
npm run benchmark
```

The default is local SQLite, 1,000 unique events, ten delivery attempts per event, four worker lanes in one process and three measured repetitions. A separate warm-up run is discarded. SQLite remains a one-process adapter: these lanes share the same driver.

For a disposable PostgreSQL database, set `CHAOS_DATABASE_URL` privately and run:

```sh
BENCH_DATABASE=postgres BENCH_EVENTS=10000 BENCH_WORKERS=8 npm run benchmark
```

The harness creates a randomly named schema and removes only that schema when finished. The connection must have schema-creation rights. Never point test tooling at a production database. Set `BENCH_LOCATION` to describe where the database runs without including hostnames or credentials.

Results include runtime/hardware, database version, connection budget, nearest-rank p50/p95/p99, CPU time, sampled RSS, operation claim contention and counts of committed effects/outbox intents. Every fulfillment must equal one; every unique event must finish; worker errors fail the run. Raw JSON is retained in `results/`.

Admission is sequential and closed loop. Processing starts after admission ends, so admission-to-commit latency includes deliberate backlog build-up. Worker iteration latency includes empty/contended claim overhead only for iterations that process work. Transaction retries can increase latency; their count is not currently instrumented. Database resource use, process recovery time, network ingress, real Stripe traffic and external deliveries are not measured. Use the separate process-failure suite for recovery correctness.

Record three or more runs for each configuration and keep the raw reports. Do not compare different databases or worker counts without holding event shape, duplicate ratio, runtime and infrastructure constant. Report errors alongside throughput; never remove slow or failed runs silently.

## First recorded baseline

The [SQLite baseline](results/sqlite-latest.json) was recorded on 3 October 2026 with Node 22.20.0, SQLite 3.50.4, a 12-logical-CPU Intel i7-9750H laptop and 16 GiB RAM. Other development work was running on the same machine; this is not a dedicated benchmark host.

| Measured run | Admission attempts/s | Committed effects/s | Duplicate effects | Worker errors |
| --- | ---: | ---: | ---: | ---: |
| 1 | 4,767 | 556 | 0 | 0 |
| 2 | 4,873 | 556 | 0 | 0 |
| 3 | 4,916 | 556 | 0 | 0 |

Each run attempted 10,000 admissions for 1,000 event identities and ended with 1,000 completed jobs, 1,000 effect guards and 1,000 outbox intents. These rates describe local store calls, not payment throughput or HTTP requests. Earlier development runs were slower and were not retained as complete benchmark artifacts; this baseline does not establish a performance trend.

The report contains the parent commit, a dirty-tree marker and a SHA-256 fingerprint of the listed source inputs. The harness was first measured before its stabilization commit. Preserve those inputs when reproducing the result; do not attribute it to an unmodified parent revision.
