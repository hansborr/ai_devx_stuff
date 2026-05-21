# Leaf 26: Ratchet Rename Count Protection

Status: Implemented (verified 2026-05-19 on `feature/lint-hardening-leaf-26-rename-count-protection`)
Source: codex review of commit `e0d2ff69` ("feat(lint): split ratchet baseline parse modes")

## Problem

Leaf 02 lets `lint:ratchet:update` accept a structurally-parsed committed
baseline so it can recover from stale registry metadata. The structural parse
intentionally accepts a baseline whose ratchet id is no longer in the registry
(rename or removal), and `decideLintRatchetUpdate` then iterates only the
*current* registry. When a ratchet is renamed:

- The committed entry under the old id is preserved in `committed.tests`.
- `compareCurrentToBaseline` looks up `committed.tests[ratchet.id]` for the
  *new* id, sees `undefined`, and skips the count check.
- Update proceeds even if the generated count under the new id is higher than
  the committed count under the old id, with no `--allow-worse --reason`
  required.

The current behavior is intentional in the "ratchet truly removed" case (no
counts to preserve), but indistinguishable from the rename case where the same
rule has just moved keys.

## Scope

Decide and implement one of:

1. Match a structurally-parsed entry to the registry by `ruleId` +
   `files` + `ignores` + `ruleOptions` when the id no longer matches.
   Use the matched entry's count as the committed floor.
2. Require `--allow-worse --reason "<why>"` whenever update is run against a
   baseline that contains entries not in the current registry, so renames
   stay an explicit decision.
3. Document the trade-off and accept that renames bypass count protection by
   design (mirrors how a config-hash change already requires the operator to
   re-run update).

Option 1 preserves the safety property in the rename case but adds matching
ambiguity (two ratchets could share scope). Option 2 is simpler and matches
the existing "intentional regression must be acknowledged" model. Option 3 is
"do nothing" if reviewers agree the rename window is narrow and human-noticed.

## Exit Criteria

- A rename that increases counts either flags as a regression or requires
  `--allow-worse --reason`, OR the trade-off is explicitly documented and
  reviewed.
- `bun run lint:ratchet:update` still recovers from stale config metadata for
  the non-rename cases that Leaf 02 enabled.
- Smoke coverage for the chosen behavior.

## Verification

- `bash scripts/test-lint-ratchet.sh`
- `bun run test:scripts:changed`
- `bun run lint:ratchet:check-baseline`

## Background

Surfaced by codex review of Leaf 02. The finding was tagged P2 — Leaf 02 is
still safe in the common stale-metadata path (e.g. `configHash` drift after
editing `lintRatchets`), and renames are rare and human-noticed. Promoting
this leaf is optional; do it before encouraging operators to rely on the
structural-parse recovery for arbitrary registry edits.

## Decision (2026-05-19)

Implemented **Option 2** (require `--allow-worse --reason` whenever the
committed baseline contains entries with no matching registry id).

Rationale:

- Option 1 (shape matching) would silently re-bind counts across renames,
  which is the *opposite* of what the count protection is for — it would
  let a rename hide a regression by preserving a higher floor. Worse, two
  ratchets sharing files/ignores/ruleOptions would be indistinguishable.
- Option 3 (do nothing, document only) leaves a real safety gap. The
  trade-off Leaf 02 made was "let structural parse recover from stale
  *metadata* without bypassing count protection." Orphan ids do bypass
  count protection (the new id has no committed floor), so the right
  fit is to require explicit acknowledgement, mirroring the existing
  `--allow-worse --reason` model for "intentional new debt."
- Option 2 is the smallest, most local change. The structural parse still
  recovers from stale `configHash` / `files` / `ignores` / `ruleOptions`
  drift in the common case (registry ids unchanged). Only the rename and
  removal cases now ask the operator to confirm.

## Implementation Notes

- `decideLintRatchetUpdate` in `scripts/lint-ratchet-baseline.ts:694`
  computes the set of registry ids, then enumerates
  `Object.keys(committed.tests)` for entries not in the registry. Orphan
  ids are sorted for deterministic output. If any exist and
  `options.allowWorse !== true`, a failure is pushed listing the orphan
  ids and pointing at the `--allow-worse --reason "<why>"` escape hatch.
- The pre-existing `--allow-worse` blank-reason guard is unchanged, so
  the operator cannot bypass count protection without supplying a real
  rationale.
- The orphan check fires regardless of whether the count comparator also
  flagged regressions; both failures surface together so the operator
  sees the full picture, not just the first issue.

## Tests

- Unit (vitest): `scripts/lint-ratchet-baseline.test.ts` —
  - the prior test that documented silent rename-recovery (line 367 in
    the pre-Leaf-26 file) was updated to assert the new refusal +
    acceptance contract;
  - a new test covers multiple orphans at once, asserting the message
    lists them alphabetically.
- Smoke (bash): `scripts/test-lint-ratchet.sh` —
  - the existing "orphan registry id" fixture now exercises both the
    refusal path (plain `--update` fails, stderr names the orphan and
    explains rename/removal, baseline is *not* rewritten) and the
    acceptance path (`--update --allow-worse --reason="..."` succeeds
    and drops the orphan).
