# Architecture decisions

These records were written during the 0.3 stabilization review on 2 October 2026. They describe and assess the current implementation; they are not a reconstructed historical discussion.

| Decision | Scope |
| --- | --- |
| [001 — Portable serializable record protocol](001-portable-storage.md) | Adapter consistency and the legacy SQL queue |
| [002 — Expiring claims and ownership tokens](002-ownership.md) | Recovery and stale completion |
| [003 — Admit before acknowledgment](003-admission.md) | Webhook durability boundary |
| [004 — Effects and outbox in one transaction](004-effects-outbox.md) | Business state and delivery intent |
| [005 — Caller-owned operation identity](005-operation-identity.md) | Retry safety and review cutoff |
| [006 — Application-owned authorization](006-authorization.md) | Tenants, resources and commercial terms |
| [007 — Optional infrastructure dependencies](007-dependencies.md) | Install footprint and selected adapters |
| [008 — Local SQLite and shared deployment stores](008-deployment-stores.md) | Persistence, scaling and operational cost |

See [the reliability contracts](../24-reliability-contracts.md). Proposed improvements should link to an issue and record measured consequences before being described as established architecture.
