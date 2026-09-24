# Security, performance, and large-scale operation

## Threat model

Name what you are protecting: customer payment authorization, tenant billing privacy, entitlement correctness, financial integrity, operational credentials, and the ability to investigate a failure. Separate an unauthenticated attacker, a malicious tenant, a compromised application service, a mistaken operator, and a delayed legitimate event. They require different controls.

| Threat | SafeStripe mechanism | Host/application responsibility |
| --- | --- | --- |
| Forged webhook | SDK signature verification over raw bytes | TLS, secret storage, clock synchronization, edge controls |
| Replay or duplicate delivery | Unique inbox identity and local effect keys | Guard retention and correct business-key design |
| Cross-tenant resource ID | Mandatory authorization callback | Authenticated membership, resource mapping, role and financial policy checks |
| Price/amount tampering | Narrow validated methods; fixed demo order | Authoritative catalog, quantity limits, frozen quote/order |
| Lost API response | Stable keys and durable operation record | Stable business ID and remote reconciliation |
| Worker crash/race | Row locks, leases, fencing, atomic effects | Every local write uses the supplied transaction |
| Database outage | No successful webhook acknowledgment before persistence | Highly available storage, backups and tested recovery |
| Secret/PII disclosure | Sanitized HTTP errors; no full API result cache | Logging controls, encryption, access review, retention |
| Request flood | Body limits and bounded local API gate | Distributed rate limiting, admission control, ingress timeout |
| Unauthorized financial action | Authorization integration point | Refund approvals, separation of duties, audit of business intent |

## Authorization is part of the payment design

Authenticate before invoking the wrapper. Derive `tenantId` and `actorId` from a trusted session/service identity. Resolve the Stripe account from server-side configuration. Never accept these values as authoritative because they appeared in a JSON body, header, query parameter, or Stripe metadata.

The authorizer receives the action, scoped resources, and normalized parameters. Verify that the actor is an active tenant member, has the required billing role, and can act on every resource. For a refund, also verify the approved refund-request record and amount. For checkout, confirm the order is owned by that tenant and the Price/quantity match its frozen terms.

Conceptual service logic:

```text
authenticate request
→ load tenant membership and allowed billing role
→ load immutable order/refund/change proposal by internal ID
→ resolve Stripe resources through trusted mappings
→ compare requested action and normalized parameters to approved proposal
→ invoke SafeStripe with the proposal's stable operation ID
→ persist the returned remote identity and audit the business action
```

A permissive `authorize: async () => true` defeats the boundary. The demo uses a fixed sandbox-only identity and permits one configured Checkout operation; replace the whole policy before production. The supplied internal replay/review helpers are not authenticated admin endpoints. Protect any UI/API built around them separately.

Database row-level security may strengthen tenant boundaries in a larger product, but SafeStripe's schema does not enable it automatically. Review connection roles, SQL access, migration privileges, and whether a compromised worker could edit other tenants' records. Parameterized queries prevent this library's ordinary SQL injection paths; they do not make a stolen database credential harmless.

## Secrets and browser exposure

Use restricted Stripe keys per service where possible. Put production secrets in your platform vault and grant read access only to the service identity that needs them. Separate sandbox and live credentials; rotate on exposure and when access changes. A webhook secret authenticates a particular destination and differs from the API key. Rotation overlap should be short and monitored. See [Stripe key practices](https://docs.stripe.com/keys-best-practices).

Use Checkout or properly configured Stripe Elements so raw card data goes directly to Stripe. This reduces the scope of data your servers handle, but does not eliminate your business's compliance responsibilities. Serve payment pages through HTTPS, review third-party scripts, and apply the CSP directives appropriate to the actual Stripe integration. See [integration security](https://docs.stripe.com/security/guide).

For cookie-authenticated mutation routes, enforce CSRF defenses, validate origin against trusted configuration, use appropriate SameSite cookie settings, and keep state-changing actions off GET. A webhook route uses signature authentication; it should not require the customer's session cookie. Exempt only the exact webhook path from browser-specific CSRF checks.

Do not return raw Stripe errors to browsers. Do not log `client_secret`, authorization headers, signing secrets, full webhook payloads, hosted payment URLs, or full customer objects. Use allowlisted structured fields such as operation kind, request ID, event ID, stable error code and elapsed time. Even these identifiers need access controls and a retention policy.

## Data retention

Inbox payloads can contain customer information. Store them with encryption at rest, restricted access, and a defined retention period. After that period, keep the minimum deduplication tombstone and operational fields needed for safe replay prevention; do not delete the uniqueness boundary inadvertently. SafeStripe currently stores payload JSONB and does not implement automatic redaction or expiry.

Successful operation rows retain remote IDs rather than full responses. Do not purge them just because Stripe's key cache is short-lived. Your business can receive old retries, operator replays and restored backups much later. Decide retention with security, finance, privacy and recovery requirements together.

## Latency budgets and overload

Separate webhook acknowledgment latency from business processing latency. The ingress path performs verification and one database insert. It should not call Stripe, calculate proration, send email, or fulfill inventory. The worker owns slower work and exposes its backlog.

The default client has a 10-second request timeout and two SDK network retries. The local gate admits eight concurrent wrapped calls, queues up to 32, and expires a queue wait after five seconds. These are conservative starting parameters, not measured optimal values. A supplied custom Stripe client can alter timeout/retry behavior; keep its worst-case duration below the operation lease and deployment request budget.

Use Little's law for an initial concurrency estimate: concurrency is approximately arrival rate multiplied by average service time. If a workload needs 40 calls/second and observed service time is 0.25 seconds, about 10 active requests are needed just for the average load. Add headroom only after considering Stripe limits, tail latency and database capacity. This example is arithmetic, not a throughput claim about SafeStripe.

Limit account-wide requests across all pods. A gate of eight in each of 100 processes allows 800 concurrent calls. The default gate is local to one instance. The `ExecutionGate` interface lets you supply a shared limiter or scheduler. Use a centralized scheduler or shared limiter when traffic warrants it, and account for Dashboard/other service traffic as well.

Stripe distinguishes rate and concurrency constraints. Classify rate-limit feedback, back off with jitter, and avoid multiplying retries at the gateway, service, SDK and worker simultaneously. Defer batch reports and backfills during interactive incidents. See [Stripe rate limits](https://docs.stripe.com/rate-limits).

## Database and queue capacity

Use a bounded connection pool and budget total connections across web replicas, worker replicas, migrations and administrative tools. Pool exhaustion can convert an upstream slowdown into a complete payment outage. In serverless environments, use a suitable connection proxy/pooler and a small per-instance pool.

Measure inbox insert latency, claim latency, lock wait time, dead tuples, WAL volume, index size, oldest pending age and worker throughput. SafeStripe's partial indexes target ready and abandoned jobs. Verify query plans with representative data; do not assume the same plan at ten million rows. Establish archival procedures that preserve deduplication keys and avoid long blocking transactions.

For a backlog of `B` jobs, arrival rate `a`, and processing capacity `c > a`, estimated drain time is `B / (c - a)`. If capacity is below arrival rate, waiting longer will not recover the system. Increase safe worker capacity, reduce nonessential incoming work, or fix the dependency bottleneck.

The projection helper locks a resource while reading Stripe. A very active subscription can become a hot row. Partition by account/resource, coalesce refresh requests where semantics permit it, and avoid fetching the same resource for every redundant event at extreme volume. Coalescing must not discard historical financial events that require individual accounting entries.

## Cache boundaries

Cache public catalog data with explicit versioning. Cache customer-facing billing summaries only with tenant/account/mode in the key and a bounded freshness contract. Never cache a secret-bearing response in a shared CDN. Payment/Portal URLs and customer billing routes require careful cache policy; the example uses `no-store` for API responses.

A cache cannot be the only deduplication store for money. Eviction, failover and TTL expiry are normal cache behavior. The authoritative command identity and business-effect guards belong in durable storage.

## Observability and service objectives

Candidate objectives to validate with the business: 99.9% of valid admitted events durably stored within one second; 99% of supported business effects completed within 30 seconds when dependencies are healthy; zero unexplained cross-tenant access; all monetary differences assigned an owner by the next reconciliation cycle. These are proposed objectives, not guarantees delivered by the repository.

Track admission success/error rate, signature/scope/version rejections, command conflicts, operations in review, oldest pending/dead job age, retry count, outbox age, reconciliation mismatches, connection wait and API latency. Avoid unbounded customer or event IDs as metric labels. Put those identities in restricted traces/logs instead.

Alert on actionable symptoms: growing backlog, unreconciled paid orders, dead financial jobs, or operations approaching the retry cutoff. A short Stripe timeout spike may be tolerable if durable work recovers; a quiet worker with no effects can be more serious than a noisy endpoint.

## Deployment and disaster recovery

Apply migrations before traffic reaches code that requires the new schema. Keep old and new workers compatible during rollout. Upgrade Stripe SDK and destination API versions as one reviewed contract change, using fixtures and parallel observation where appropriate. An old event payload does not retroactively acquire the shape of a newer SDK type.

Restore backups in an isolated environment and compare operation/effect records with Stripe activity after the restore point. Lost local records can cause duplicate operations after recovery. Keep payment writes disabled until those gaps are understood. Document RPO/RTO targets and test the runbook with the people who will execute it.

A large deployment needs measured capacity, security review, incident ownership, financial controls, and tested infrastructure. Review these responsibilities with the teams that will operate the service.
