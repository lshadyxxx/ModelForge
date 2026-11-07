# Security Policy

## Supported versions

ModelForge is currently an experimental reference implementation. Security fixes
are applied to the default branch on a best-effort basis; no long-term-support
branch is promised.

## Reporting a vulnerability

Please do not disclose security issues in a public issue. Use GitHub's private
vulnerability reporting / Security Advisory feature for this repository.

Include:

- affected component and commit;
- reproduction steps;
- expected and observed behavior;
- impact and any known workaround.

Please allow time for triage before publishing details. We may ask for a
redacted log bundle, but never send cloud credentials, private keys, production
database DSNs, model weights or personal data.

## Scope notes

- The default Compose stack is intended for local or controlled-network use.
- The control plane does not currently provide user authentication, RBAC or
  multi-tenant isolation.
- Cloud credentials must be injected only through backend environment secrets.
- AI diagnosis is advisory and must not be treated as a security or delivery
  hard gate.

If a credential was exposed, revoke and rotate it first; do not wait for a code
fix or history cleanup.
