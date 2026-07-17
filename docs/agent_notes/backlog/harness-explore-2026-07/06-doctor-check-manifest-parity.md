# 06 — doctor-check ids are not parity-gated against the manifest

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

## Evidence (verified 2026-07-11; re-verified in 2026-07-11 adversarial triage; re-verify before implementing)

- `harness.controls.json` declares 13 `doctor-check` controls; the same ids
  are independently hardcoded in `scripts/doctor.sh:433-797` as
  `CURRENT_CONTROL=` strings and `run_subcommand` id args.
- `scripts/harness-check.ts` verifies only that each control's `source` file
  exists — it never confirms that every manifest `doctor-check/*` id is
  actually emitted by `doctor.sh` (and vice versa), unlike the rule, script,
  and ratchet parity checks it already runs via
  `scripts/harness/harness-check-validation.ts` (`checkRuleParity`,
  `checkScriptParity`, `checkRatchetParity`).
- Package-script parity does not cover this: doctor checks are internal to
  `doctor.sh` and add no package.json script, and several manifest entries'
  `source` is a script that would keep existing (or `scripts/doctor.sh`
  itself) after the check is removed.

Failure: a check removed or renamed in `doctor.sh` leaves a stale manifest
entry (and a phantom row in the generated harness-controls doc) that
`harness:check` passes forever; a check added to `doctor.sh` without a
manifest entry is equally invisible.

## Do

Add a `checkDoctorParity` beside the existing parity checks in
`scripts/harness/harness-check-validation.ts` and wire it into
`scripts/harness-check.ts` (not a vitest tripwire — the
`harness-controls-parity.test.ts` pattern is a hardcoded-copy tripwire that
does not run under `harness:check` and cannot satisfy the acceptance
criterion): statically extract the `doctor-check/…` string literals from
`scripts/doctor.sh` (`CURRENT_CONTROL="doctor-check/…"` assignments plus
quoted `run_subcommand` id args) and diff both ways against the manifest's
`doctor-check` entries. Filter extraction to the `doctor-check/` prefix —
`doctor.sh` also emits `sensor/*` and `verify-wrapper/doctor` control ids
that belong to other kinds. Cover the new check in
`scripts/harness/harness-check-validation.test.ts`.

## Verify

```
bun run harness:check
bun run test:scripts:changed
```

## Acceptance

Removing, renaming, or adding a doctor check without updating
`harness.controls.json` (or vice versa) fails `harness:check`.
