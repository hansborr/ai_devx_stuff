# 13a: Doctor --json Working-Directory Handling For harness:check

Status: Done (2026-06-12, landed in "fix(lint): run doctor json harness from root")
Order: 13a
Source: carried forward from the deleted legacy Leaf 42 note during the
2026-06-11 backlog cleanup (formerly item 1 of the Leaf 13 bundle).

## Context

The default-mode doctor subcommand wrappers run from `$REPO_ROOT`, but the
JSON-mode branch in `run_harness_check` directly invokes
`bun run harness:check`, so a subdirectory invocation may resolve paths
differently than the default mode does.

## Scope

1. Reproduce `scripts/doctor.sh --json` from a subdirectory before changing
   anything.
2. If reproducible, wrap the JSON-mode invocation in the same
   `(cd "$REPO_ROOT" && ...)` pattern used by the shared subcommand helpers,
   and add or update doctor smoke coverage for a subdirectory `--json` run.
3. If NOT reproducible, record that finding in this leaf and mark it Done —
   no code change.

## Definition Of Done

`scripts/doctor.sh --json` behaves identically from the repo root and any
subdirectory, or this leaf records that the repro no longer exists.

## Verification

- Focused doctor smoke test or `bash scripts/tests/test-verify.sh`
- `bun run verify:changed`

## Notes

- Reproduced before changing code from `packages/client/src`:
  `scripts/doctor.sh --json` emitted `harness-check-failed` with
  `error: Script not found "harness:check"`. The shallower `scripts/`
  subdirectory did not reproduce because Bun resolved the root package script
  from there.
- Wrapped the JSON-mode `harness:check` invocation in
  `(cd "$REPO_ROOT" && bun run harness:check)` and added a doctor JSON smoke
  assertion that fails if the nested-subdirectory run executes
  `harness:check` outside the repository root.
  `bash scripts/tests/test-doctor-json.sh` is green.
- Re-ran the real nested invocation after the fix; it still exits non-zero for
  unrelated local doctor findings, but it no longer emits a
  `harness-check-failed` finding.
