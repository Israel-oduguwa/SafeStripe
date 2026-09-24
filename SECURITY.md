# Security policy

SafeStripe coordinates financial operations with an application database. Review both the library and the application's authentication, authorization, deployment, and recovery procedures before accepting live payments.

## Report a vulnerability

Use the repository's private vulnerability reporting channel when it is enabled. If it is unavailable, contact the maintainer through a published private contact method before sending sensitive details. Do not include keys, customer records, card data, or working exploit details in a public issue.

The maintainer must configure a private reporting channel before the first public release. No response-time commitment is established for this initial release candidate.

Include the affected package version, a minimal reproduction with synthetic data, the relevant account scope, and the expected versus observed behavior. A report showing a failed invariant is more useful than a general claim that payments are insecure.

## Scope

This release supports API v1 snapshot events at the pinned API version and one trusted account scope per receiver. Organization-context routing and thin events require a separate integration. Direct calls through the official SDK bypass SafeStripe's authorization and durable-command protocol.

The application must provide authenticated identity, resource ownership, approved commercial terms, restricted service keys, secure secret storage, HTTPS, ingress controls, and a monitored database and worker deployment. See [Security and scale](docs/07-security-and-scale.md) for the threat model.

The public error contract and observer hooks omit raw errors and payment payloads. Application logs, custom handlers, and exporters need the same care. Database payloads may contain personal information from events; restrict access and set a retention policy.

## Credentials and dependency updates

The test credentials in the repository are synthetic fixtures. `.env.example` contains no Stripe credentials. Actual test keys authorize account actions and must be protected like other service credentials. Rotate any exposed key; deleting it from a file does not revoke it.

After creating a Git repository in this folder, enable the supplied staged-secret check:

```sh
git config core.hooksPath .githooks
```

The hook scans staged text for likely Stripe keys and signing secrets without printing their values. It supplements repository secret scanning and dependency review. It cannot detect every secret or every form of accidental disclosure.

Review dependency changes with the lockfile, rerun failure tests and installed-package checks, and record compatibility changes in the changelog. Update Stripe SDK and webhook API versions together through a reviewed migration plan.
