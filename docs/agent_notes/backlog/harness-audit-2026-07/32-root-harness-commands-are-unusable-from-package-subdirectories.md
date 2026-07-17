# 32 — Root harness commands are unusable from package subdirectories

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

Related: [agent-friction U1](../agent-friction-2026-06/00-report.md#tier-3--valuable-more-effort-or-lower-frequency), which covered only doctor’s internal `harness:check` invocation.

> **Confirmed — 2026-07-13 adversarial triage.** All five representative commands were reproduced as `Script not found`. Bun’s error text is not customizable, so recovery needs a root-anchored launcher or explicit documentation.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/doctor.sh:415-421` — doctor documents Bun’s nearest-package resolution and internally works around it for `harness:check`.
- `package.json:23`, `package.json:32`, `package.json:56`, and `package.json:102` — the affected tools are root-only scripts.
- From package source directories, doctor, backlog lint, code intel, harness check, and worktree status all failed before tool-specific guidance could run.

Failure: An agent working inside `packages/client` or `packages/server` receives no path back to common root harness commands.

## Do

Extend the landed doctor-internal workaround into a user-facing root launcher and/or document the exact recovery form: `bun --cwd="$(git rev-parse --show-toplevel)" run …`. Cross-link the narrow earlier agent-friction U1 treatment in `../agent-friction-2026-06/`. Current Bun 1.3 requires the `--cwd=<path>` form; separating the option from its value prints help and exits 0.

## Verify

```
cd packages/client/src && bun --cwd="$(git rev-parse --show-toplevel)" run harness:check
```

## Acceptance

- Every named root tool has a discoverable invocation from a package subdirectory.
- The recovery path preserves arguments and exit status.
