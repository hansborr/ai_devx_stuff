# 40. Generated-surface freshness never blocks locally — land.sh can merge stale harness surfaces to main

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: verify-pipeline · Area: verify-gates · Severity: high · Size: S-M · Confidence: high
Theme: local-ci-gate-parity · Source: harness review 2026-07-06 (three agents independently + Codex PARTLY-confirmed)

## Problem
`bun run harness:check` (freshness of all six generated surfaces —
settings.json hooks region, `steps.generated.sh`, generated docs,
restricted-disable rules — plus manifest/script/rule parity) hard-fails
only in CI. Locally, `.husky/pre-commit` merely *warns*, and only when
generator/manifest files are among the staged paths; `scripts/land.sh`
runs full `bun run verify`, whose slot set contains no harness-freshness
slot. Net: a branch can be committed and *merged into main locally* with
stale generated surfaces — including `.claude/settings.json`, the actual
enforcement surface Claude Code reads — and the drift surfaces only when
CI runs post-push, after the merge already happened. Three audit agents
converged on this independently.

## Evidence
- `.husky/pre-commit:170-198` — `warn_if_generated_surface_stale`,
  non-blocking, staged-paths-conditional.
- `scripts/land.sh:44` — full verify; `scripts/verify/steps.generated.sh:12`
  — slot list has no harness/freshness entry.
- `.github/workflows/ci.yml:168` — the only gating caller;
  `scripts/doctor.sh:373` runs it report-only.
- Codex verification: PARTLY (CI-only narrowed by the doctor.sh caller;
  the "nothing local gates" core confirmed).

## Proposed direction
Smallest effective fix: run the freshness subset (`harness:check`'s
generated-freshness + wiring-structure checks, or the six `--check`
scripts directly) as a hard gate inside `land.sh` before verify — it is
fast (no lint/test work) and land is the exact moment stale surfaces
would enter main. Alternative/additional: a `harness-freshness` slot in
the manifest's `verify` consumer (regenerating steps.generated.sh), which
also covers manual `bun run verify` users. Keep pre-commit advisory for
iteration speed — that trade-off is deliberate and fine once land gates.

## Scope / caveats
Watch runtime: full `harness:check` includes parity scans; if it is slow,
gate only `checkGeneratedFreshnessOutputs` + `harness:wiring:check`. See
also `ci-local-gate-parity-guard.md` in the backlog root for the general
pattern. One commit (land.sh or manifest + regen).
