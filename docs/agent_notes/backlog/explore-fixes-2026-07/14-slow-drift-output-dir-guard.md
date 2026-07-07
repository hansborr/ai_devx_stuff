# 14 — Harden `slow-drift-audit.sh` output-dir reset against broad paths

Status: Ready
Track: T (tooling) · Priority: P1 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/slow-drift-audit.sh:25` (`reset_output_dirs`) — guards only `""`,
  `/`, and `.` before `rm -rf "$ENVELOPE_DIR" "$PRODUCER_DIR" "$FUSED_DIR"`.
  `MUSI_SLOW_DRIFT_OUTPUT_DIR=/tmp` would delete `/tmp/envelopes`,
  `/tmp/producers`, and `/tmp/fused` — directories the script does not own.

## Do

Constrain the output dir before any `rm -rf`: require it to resolve under the
repo's `reports/` (or another explicitly-sanctioned root), or bound the
delete to paths the script created (marker-file check). Fail with the
existing `fail` helper otherwise. Add unsafe-path cases to the shell test.

## Verify

```
bash scripts/tests/test-slow-drift-audit.sh
```

## Acceptance

`MUSI_SLOW_DRIFT_OUTPUT_DIR=/tmp` (and similar broad paths) fails fast with a
clear message and deletes nothing; the default path continues to work.
