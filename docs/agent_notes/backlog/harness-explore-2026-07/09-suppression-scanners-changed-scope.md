# 09 — Suppression scanners have no changed-scope mode

Status: Done
Track: T (tooling) · Priority: P2 · Size: M

## Evidence (verified 2026-07-11; re-verified at 2026-07-11 adversarial triage; re-verify before implementing)

- `scripts/eslint-disable-register.sh:221-239` and
  `scripts/suppression-register.sh:229-248` — both scan the entire tracked
  `*.ts/js/...` tree (2479 files) line-by-line in bash on every commit gate,
  with no `--changed` mode. Measured at triage: ~18s each, ~36s sequential
  per `lint:suppressions` run (`scripts/lint-suppressions.sh` runs them
  back-to-back), in every slot set including pre-commit
  (`MUSI_PRE_COMMIT_SUPPRESSIONS_CMD` and
  `MUSI_VERIFY_CHANGED_SUPPRESSIONS_CMD` in
  `scripts/verify/steps.generated.sh`).
- Their siblings all have one: `lint-changed.sh`, `lint-config-sensors.sh`
  (`:189-209`), `lint-agent-changed.sh`. Only changed files can introduce a
  new suppression-policy violation, so full-tree work at commit time buys
  nothing.

## Do

Add a changed-scope mode to both scanners using the shared collection helper
(see [08](./08-shared-changed-file-collection.md)); keep the full-tree mode
for `verify` and audits. Two scoping requirements beyond the plain sibling
pattern:

- Register a `full-scan-trigger` for the scanner scripts themselves: the
  allowlists (`BROAD_ALLOWLIST`, `TS_NOCHECK_ALLOWLIST`) are embedded in
  them, so a commit that edits either script must escalate to a full scan or
  a shrunk allowlist could leave violations in unchanged files undetected.
- Label the changed-scope summary output as scoped (the `total=` counts are
  per-run, not repo-wide) so PASS lines are not misread as register totals.

Wire the changed variant into both the pre-commit and `verify:changed` slot
sets via the verify-steps generator; full `verify` keeps the full-tree
commands.

## Verify

```
bash scripts/tests/test-eslint-disable-register.sh
bash scripts/tests/test-suppression-register.sh
bun run test:scripts:changed
```

## Acceptance

Commit-time and `verify:changed` suppression scanning touches only changed
files (with full-scan escalation when the scanner scripts change); full-tree
scans remain available and are still run by full `verify`.
