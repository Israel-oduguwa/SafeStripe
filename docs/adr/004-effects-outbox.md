# Effects and outbox share a transaction

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

An event ID is a transport identity. Multiple different events can correspond to one fulfillment, while a downstream receiver is outside the database transaction.

## Decision

Use a stable business effect key. Commit its guard, billing records and outbox intent together. Dispatch later with a stable delivery key and require recipient deduplication.

## Alternatives considered

Mark an event processed before handling; send email within the transaction; attempt two-phase commit with arbitrary third parties.

## Consequences and trade-offs

Callbacks can retry and must not perform external writes. Delivery is at least once. A receiver can accept work and lose its response; retrying is correct only when it deduplicates. Portable transactions cover SafeStripe records, not arbitrary external application records.
