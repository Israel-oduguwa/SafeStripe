# Admit before acknowledgment

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

The HTTP response and database commit cannot be atomic. A webhook provider may retry an uncertain delivery.

## Decision

Verify the signed raw body and scope, then await durable admission before returning success for supported events. Use event identity to make admission repeatable. Explicitly ignore only authenticated unsupported event types.

## Alternatives considered

Acknowledge then enqueue; an in-memory queue; complete fulfillment inside the request.

## Consequences and trade-offs

A failed database causes failed admission and a retryable response. A lost response after commit produces a duplicate delivery, which finds the existing job. Durable admission is dependent on database persistence and retention; it cannot survive losing the authoritative database.
