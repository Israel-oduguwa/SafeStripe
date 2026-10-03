# Expiring claims and ownership tokens

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

A process can stop without releasing its job. A slow process can also continue after another worker takes ownership.

## Decision

Give each claim a fresh token and an expiry. Check both ownership and eligible state in the completion transaction. Exhausted attempts become dead work for reviewed recovery.

## Alternatives considered

Permanent locks; deleting abandoned rows; a process-local mutex; unrestricted retries.

## Consequences and trade-offs

Recovery needs a live worker and available storage. Tokens fence database completion, not arbitrary remote requests. Handler execution can repeat. Set a lease budget that covers bounded work and review long-running handlers rather than assuming expiry cancels them.
