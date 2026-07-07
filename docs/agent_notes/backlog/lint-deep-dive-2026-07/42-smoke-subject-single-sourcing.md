# 42. Script smoke tests register in three places — subject data, run-order, and a static fixture; generate them from one

Status: Done — smoke subjects and the all-smokes fixture are generated from smoke-file headers.
Lens: pipeline · Area: registration ergonomics · Severity: med · Size: M · Confidence: high
Theme: registration-burden · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents); matches recorded field pain (memory: adding a script smoke test)

## Problem
A new `scripts/tests/test-*.sh` must be registered in (1)
`path-policy-smoke-subjects-data.ts` (changed-mode subject selection), (2)
the query-test run-order expectation, and (3) the static all-smokes fixture
in `scripts/tests/test-test-scripts.sh` — while *full*-mode discovery is
directory-based. Forget (1) and the smoke exists, runs in full mode, but
changed-mode never selects it for the files it covers; forget (3) and the
fixture gate fails with a confusing diff. Recorded as tribal-knowledge memory
precisely because nothing in-repo teaches or checks it.

## Evidence
- `scripts/path-policy/path-policy-smoke-subjects-data.ts:23-60,191-200` — hand-maintained subjects. Verified 2026-07-04.
- `scripts/test-scripts.sh:120-128,166-200` — directory-backed full discovery; `scripts/tests/test-test-scripts.sh:77,118-123` — static expectation.

## Proposed direction
Make each smoke test self-describing: a structured header comment in the
`test-*.sh` file (`# smoke-subjects: scripts/foo.sh scripts/lib/foo-*.sh`)
parsed by a small generator that emits the subjects table and the all-smokes
fixture (generated-file + `--check` drift gate, same pattern as
`steps.generated.sh`). Add a checker failure for a smoke file with no
subjects header, so the "no subject owner" state is unrepresentable.

## Scope / caveats
- Keep the parsed header trivially greppable; it doubles as documentation at
  the point of authorship.
- Migration commit converts existing smokes' subjects into headers
  mechanically and deletes the hand tables; the memory note can then be
  retired.
