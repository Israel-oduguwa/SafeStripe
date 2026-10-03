# Callers supply business operation identity

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

A random key generated on every HTTP attempt cannot identify an earlier ambiguous request. The library cannot infer whether two equal refunds are a retry or two intentional refunds.

## Decision

Require the caller to persist an operation ID for the business action. Bind scope, kind and input fingerprint to it. Reuse a stable Stripe key and retain completed resource IDs. Stop automatic recovery of unresolved operations at the configured cutoff.

## Alternatives considered

Generate a new key per attempt; hash parameters alone; retry old operations indefinitely.

## Consequences and trade-offs

Applications must distinguish intent from retries. Identical parameters can describe different intentional actions. Database restore and retention can erase the local guard; reconciliation is needed before writes resume. The cutoff preserves uncertainty rather than claiming an old remote write failed.
