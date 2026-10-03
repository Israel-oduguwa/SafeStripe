# Authorization belongs to the application

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

The library knows Stripe objects but does not know membership, resource ownership, approved prices or refund policy for every application.

## Decision

Require an authorizer for every wrapped write and replay. Supply validated actor, action, resources and parameters. Keep webhook scope verification distinct from user authorization.

## Alternatives considered

Accept all authenticated callers; trust customer or price IDs from the browser; embed a fixed role system in the library.

## Consequences and trade-offs

Integration takes more setup, but tenant policy stays explicit and reviewable. An operation ID is not a credential. The local demo policy is only an example. Direct SDK access bypasses these checks and must not be presented as a protected SafeStripe operation.
