# Lint Tool Doctor Parity

Status: Parked
Order: 10

## Context

ShellCheck and yamllint are system dependencies in CI. Taplo, actionlint, and
hadolint use mixed npm/system-wrapper surfaces. The source review recommends
making provisioning and version reporting first-class for reference users.

Overlap: earlier external-tool provisioning and dev-parity tasks covered part
of this and have landed. Re-audit before promoting; some provisioning work has
already landed locally.

## Scope

- Re-audit `scripts/doctor.sh`, `scripts/lint-shell.sh`,
  `scripts/lint-config-sensors.sh`, CI bootstrap steps, devcontainer docs, and
  onboarding docs.
- Report versions for ShellCheck, yamllint, actionlint, taplo, hadolint,
  ESLint, Prettier, and Bun where practical.
- Clearly distinguish pinned npm tooling from host/system dependencies.
- Document install commands for devcontainer, local Linux, and CI.
- Fail loudly with actionable guidance when required tools are missing.

## Definition Of Done

A new contributor or reference adopter can discover required lint tools, install
them, and see the versions used by local and CI lint gates.

## Verification

- `bun run doctor`
- Doctor JSON/smoke tests if doctor output changes
- `bun run lint:shell`
- `bun run lint:config-sensors`
- `bun run verify:changed`
