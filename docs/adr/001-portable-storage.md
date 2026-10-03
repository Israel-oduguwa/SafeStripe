# Portable serializable record protocol

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

Four stores must implement the same operation, queue and effect semantics. The original SQL API uses dedicated tables and SKIP LOCKED; the portable API stores records in sf_records.

## Decision

Keep the portable record protocol serializable. PostgreSQL selects candidates and rechecks them inside a serializable transaction with bounded retries. MongoDB and Firestore use their transaction mechanisms. Maintain the legacy SQL implementation as a separate compatibility path.

## Alternatives considered

A PostgreSQL-only queue using SKIP LOCKED; a broker plus per-database projections; database-specific public APIs.

## Consequences and trade-offs

The contract is testable across stores, but contention, transaction limits, indexes and clocks differ. Candidate scans can create hot records. Benchmarks must distinguish adapters and both SQL APIs. Redis or Kafka would add another operational system without removing the need for database transaction boundaries.
