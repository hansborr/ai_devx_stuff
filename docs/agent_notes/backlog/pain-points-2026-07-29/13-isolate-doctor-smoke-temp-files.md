# Isolate Doctor Smoke Temporary Files

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: Task A live-tree cross-lane fixture audit

## Problem

`scripts/tests/test-doctor-json.sh:233-242` captures two real command results in
fixed host-global files, `/tmp/doctor-help.out` and `/tmp/doctor-bad.out`, then
removes both at `scripts/tests/test-doctor-json.sh:803-805`.
`test-doctor-json.sh` is a registered scripts smoke
(`scripts/path-policy/path-policy-smoke-subjects-data.ts:731-737`), so sibling
worktrees can execute it in their verify `scripts` slots at the same time.

One instance can truncate or unlink the other's help output before its grep,
creating a false verify failure unrelated to either tree. This is a live
cross-lane path collision, not host load and not C8 command-target work.

## Scope

- In `scripts/tests/test-doctor-json.sh`, allocate the help and invalid-argument
  captures under the suite's existing `TMP_ROOT` or with `mktemp`.
- Read and clean only those per-invocation paths; remove every reference to the
  two fixed `/tmp/doctor-*.out` names.
- Keep the existing help-text assertion and unknown-argument exit-2 assertion
  unchanged.
- Add a structural assertion in the smoke that its capture paths are contained
  by its private root and distinct from one another.
- Do not change `scripts/doctor.sh`, its output, or smoke-subject routing.

## Acceptance

- Two instances of `bash scripts/tests/test-doctor-json.sh` can overlap without
  opening, truncating, reading, or deleting the same path.
- `rg -n '/tmp/doctor-(help|bad)\\.out' scripts/tests/test-doctor-json.sh`
  returns no matches.
- Cleanup of one instance cannot remove another instance's captures.
- `bash scripts/tests/test-doctor-json.sh` and
  `bash scripts/tests/test-test-scripts.sh` pass.

## Resolved decisions

- Reuse the suite's private temporary root. The files are test artifacts with
  no operator-facing stable-path contract.

## Open questions

None.
