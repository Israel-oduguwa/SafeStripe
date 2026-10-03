# Local SQLite and shared deployment stores

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

The shipped SQLite driver uses a synchronous connection, an in-process transaction queue and a local file. Serverless filesystems and independent replicas do not share that queue or file.

## Decision

Support this SQLite adapter for local, single-process use. Use shared PostgreSQL, MongoDB or Firestore for deployed multi-instance integrations. Keep database operation and backup responsibilities explicit.

## Alternatives considered

Treat every SQLite deployment as equivalent; copy database files among instances; require every local user to run a server database.

## Consequences and trade-offs

Local onboarding stays lightweight. This is a support boundary for this driver, not a claim that SQLite can never serve production systems. Shared stores add IAM, indexing, transaction budgets, quotas and operational cost. Conformance proves tested semantics, not equal performance or capacity.
