# Changed-Wrapper Merge-Base Preflight

Status: Done (2026-06-11, landed in "fix(lint): preflight merge-base in all
changed wrappers")
Order: 01
Source: Codex review item 2, broadened after verification.

## Context

`scripts/lint-agent-changed.sh:148` preflights `git merge-base "$BASE" HEAD`
before using `$BASE...HEAD`, with a comment explaining why: orphan branches
and partially-fetched clones can have both refs resolvable yet share no
history, and a `git diff` fatal inside `<(...)` process substitution does not
propagate through `set -e`, so the wrapper would silently under-scan.

Six other wrappers use `$BASE...HEAD` after only a `rev-parse` existence
check (local ref, then `origin/<base>` fallback), without the merge-base
preflight:

- `scripts/lint-changed.sh`
- `scripts/lint-shell.sh`
- `scripts/lint-config-sensors.sh`
- `scripts/format-changed.sh`
- `scripts/test-changed.sh`
- `scripts/test-scripts.sh`

Each already has a conservative full-scan fallback for the missing-ref case;
the no-common-ancestor case should route to the same fallback instead of a
swallowed diff failure.

## Scope

- Extract a shared base-ref resolution + merge-base preflight helper into
  `scripts/lib/` (or extend `scripts/lib/verify-metadata.sh`), modeled on the
  `lint-agent-changed.sh` behavior including its loud stderr message.
- Adopt it in all six wrappers, falling back to each wrapper's existing
  full-scan path.
- Keep `lint-agent-changed.sh`'s `--print-files` `FULL_SCAN` contract intact
  if it migrates to the shared helper.
- Extend the script test surface with an orphan-branch (or
  `git commit-tree`-built disjoint ref) case asserting the full-scan fallback
  fires for at least one wrapper of each family (lint, format, test).

## Definition Of Done

No changed wrapper can silently under-scan when the base ref exists but
shares no history with HEAD; the failure mode is the same loud full-scan
fallback everywhere.

## Verification

- `bun run test:scripts:changed`
- Manual repro: disjoint base ref, confirm each wrapper announces the
  full-scan fallback
- `bun run verify:changed`

## Notes (2026-06-11)

- Helper landed as `scripts/lib/changed-base.sh` (new file, not a
  `verify-metadata.sh` extension): `musi_resolve_changed_base` sets
  `MUSI_CHANGED_BASE` on success and `MUSI_CHANGED_BASE_ERROR` on failure.
  The caller prints the loud message so `lint-agent-changed.sh
  --print-files` keeps its silent `FULL_SCAN` contract; the error
  fragments match the wrappers' previous wording exactly, so existing
  smoke assertions held without edits.
- All seven wrappers adopted it, including `lint-agent-changed.sh` (its
  two inline blocks collapsed into one helper call).
- Orphan-branch smoke cases added per family: `test-lint-changed.sh`,
  `test-format-changed.sh`, `test-test-changed.sh`
  (`test-lint-agent-changed.sh` already had cases 22/23), plus
  `test-test-scripts.sh` after subagent review flagged its `&&`-chain
  error-variable propagation as the one consumer worth pinning. lint-shell
  and lint-config-sensors were verified by manual disjoint repro; their
  fallback message now goes to stderr (was stdout).
- Surprise: the new subject entries pushed
  `path-policy-smoke-subjects.ts` over the 400-effective-line
  `local/max-lines` limit; factored the repeated five-entry ESLint config
  surface into `ESLINT_SURFACE_SUBJECTS` (same-file precedent:
  `PATH_POLICY_QUERY_SUBJECTS`) instead of splitting the module, which
  would have forced new copies into every sandbox smoke test.
- Pre-existing wording quirk left alone: in full-fallback mode lint-shell
  and lint-config-sensors still print the `--changed`-flavored "no
  staged/base changed ... vs main — skipping" line when the full set is
  empty.
