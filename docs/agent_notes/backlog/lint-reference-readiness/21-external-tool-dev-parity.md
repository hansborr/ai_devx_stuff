# External Tool Dev Parity

Status: Done
Order: 21

## Context

After CI provisioning is explicit, local development environments need the
same documented tool surface so contributors do not discover missing lint tools
only at commit or CI time.

## Scope

- Mirror the system tool installation path in devcontainer configuration or
  onboarding docs.
- Document which tools are intentionally system packages and which are pinned
  npm wrappers.
- Keep the documentation aligned with `doctor` version reporting.

## Definition Of Done

A fresh devcontainer or documented local bootstrap can reach the same required
lint tool surface as CI.

## Verification

- Documentation/config formatting checks
- Devcontainer or bootstrap validation where available
- `bun run doctor` if docs/config affect doctor expectations
