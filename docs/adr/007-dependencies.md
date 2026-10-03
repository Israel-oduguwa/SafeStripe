# Optional infrastructure dependencies

Status: accepted for the stabilization branch. Recorded 2 October 2026.

## Context

A SQLite backend should not receive PostgreSQL and payment-UI packages merely because the package exposes those features. The previous runtime dependency graph did exactly that.

## Decision

Keep Stripe and validation in core. Make pg and the Stripe browser libraries optional peers. Retain explicit framework/storage/UI subpaths and install each dependency when selecting its feature. Load pg only when the migration CLI needs it.

## Alternatives considered

One package per adapter; bundle every dependency; dynamically download modules at runtime.

## Consequences and trade-offs

Core installs are smaller and intentional. Optional consumers need clear install instructions and tested version ranges. Clean consumers must test missing optional packages as well as feature-enabled imports. Type-only Express dependencies remain in the distribution and are disclosed rather than hidden.
