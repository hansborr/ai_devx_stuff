# 52. Config sensors fail fast across tool families — report all failing families in one pass

Status: Done — implemented on 2026-07-04.
Lens: pipeline · Area: config sensors · Severity: low · Size: S · Confidence: high
Theme: gate-ergonomics · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`lint-config-sensors.sh` accumulates per-file failures for actionlint, but
runs the subsequent families (yamllint, taplo, hadolint) under `set -e`
fail-fast. Coexisting YAML and Dockerfile failures surface one gate cycle at
a time — a needless round-trip in a gate whose whole job is batch reporting.

## Evidence
- `scripts/lint-config-sensors.sh:3` (set -e), `:367-455` — actionlint accumulates; later families exit on first failure. Verified 2026-07-04.

## Proposed direction
Extend the actionlint accumulator pattern to all families: run each tool,
collect nonzero statuses + outputs, print every failing family's findings,
exit nonzero if any failed. Keep per-family SKIP behavior for missing tools
unchanged.

## Scope / caveats
- Pure ergonomics; no policy change. One commit + smoke-test update if the
  smoke asserts output shape.
