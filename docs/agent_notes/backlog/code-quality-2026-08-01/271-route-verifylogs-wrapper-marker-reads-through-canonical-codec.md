# 271. Route verify:logs wrapper-marker reads through the canonical marker codec

Status: Landed on fix/cq-271
Theme: single wrapper-marker codec for gate state and log reporting · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The verification log viewer already sources `scripts/lib/verify-metadata.sh`,
but implements a second validator for the same three-field success-marker
protocol (`LAST_TS`, `LAST_HEAD`, `LAST_HASH`). A protocol change therefore has
two Bash readers and two test surfaces to update even though the viewer has the
canonical reader in scope.

This is demonstrated drift, not just prospective duplication. The viewer's
copy overwrites repeated fields and accepts the marker, while the canonical
codec rejects a second occurrence of any field. Reporting can consequently
promote a wrapper log to `OK*` from a marker that the gate considers corrupt.

## Evidence

All references are at the audit pin `ebf096580`; the behavioral comparison
below was re-derived against the same source tree.

- `scripts/verify-logs.sh:33-44` — the viewer sources
  `scripts/lib/verify-metadata.sh` and obtains all three wrapper-marker paths
  through that library, so no dependency or path boundary prevents reuse.
- `scripts/verify-logs.sh:190-215` — `read_wrapper_marker_ts` independently
  decodes `LAST_TS`, `LAST_HEAD`, and `LAST_HASH`. Its cases assign the latest
  value and merely set each `saw_*` flag to `1`; none rejects a field whose flag
  is already set.
- `scripts/verify-logs.sh:219-245`, `:315-328`, and `:702-720` — four call sites
  use that local reader to select the latest marker, decide whether any marker
  is unreadable, render `(corrupt)`, and emit corrupt-marker diagnostics.
- `scripts/lib/verify-metadata.sh:783-830` — the already-sourced canonical
  `musi_read_success_marker` implements the same three-field protocol, but
  lines 798, 803, and 808 explicitly reject a repeated field before assigning
  its exported `MUSI_MARKER_LAST_*` value.
- Re-derived divergence: with a current wrapper marker containing two identical
  `LAST_TS` lines plus one valid `LAST_HEAD` and 64-hex `LAST_HASH`, the real
  `scripts/verify-logs.sh` summary rendered the corresponding log as `OK*` and
  the marker as `0s ago`; sourcing `scripts/lib/verify-metadata.sh` and passing
  that same file to `musi_read_success_marker` returned rejection. The
  path-level cause is the missing duplicate guard at
  `scripts/verify-logs.sh:198-205` versus the three guards at
  `scripts/lib/verify-metadata.sh:795-810`.
- `scripts/tests/test-verify-metadata.sh:68-124` — the canonical codec suite
  owns the exact three-field acceptance contract and pins duplicate-field
  rejection. `scripts/tests/test-verify-logs.sh:194-240` separately exercises
  the viewer's corrupt-marker presentation for unknown, incomplete, and
  malformed markers, but has no duplicate-field case.

## Proposed direction

Delete `read_wrapper_marker_ts` and replace it with a thin viewer adapter over
`musi_read_success_marker`. On success, derive `MARK_AGE` from the exported
`MUSI_MARKER_LAST_TS` and print that timestamp for the existing
`latest_wrapper_ts` callers. Keep the viewer's four integration uses on that
adapter so summary promotion, human `(corrupt)` presentation, and JSON corrupt-
marker findings all receive the canonical verdict.

Keep marker-shape acceptance and rejection cases in
`scripts/tests/test-verify-metadata.sh`; retain focused viewer tests for its
observable summary and corrupt-marker presentation. Verify the seam with
`bash scripts/tests/test-verify-metadata.sh`,
`bash scripts/tests/test-verify-logs.sh`, `bash scripts/lint-shell.sh`, and
`bun run harness:check`.

## Scope / caveats

- **Keep success-marker and TTL handling in Bash.** CQ25-124 records the prior
  decision not to port this strict, hot-path marker cluster to TypeScript. This
  leaf removes a second Bash reader through the existing Bash API; it does not
  reopen that substrate ruling.
- Preserve all `verify:logs` behavior other than eliminating its divergent
  acceptance: the same log selection, `OK*` derivation, age display, human
  `(corrupt)` output, JSON finding shape, and repair text remain in place.
- Coordinate with
  [117-verify-metadatash-second-kitchen-sink-shell.md](./117-verify-metadatash-second-kitchen-sink-shell.md),
  whose move-only decomposition places the canonical function in an internal
  marker library. `scripts/lib/verify-metadata.sh` remains the public aggregator
  and the viewer continues sourcing it even if the function moves internally.
- Out of scope: changing the three-field marker format, freshness windows,
  marker writers, state-path derivation, or any TypeScript run-metadata codec.
