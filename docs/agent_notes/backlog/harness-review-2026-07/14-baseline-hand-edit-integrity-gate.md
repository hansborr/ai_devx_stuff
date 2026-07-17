# 14. A hand-edited baseline count increase passes the gate with no --allow-worse and no debt-log line — add a merge-base integrity check

Status: Done — `baseline-debt-accounting*.ts` wired as `--check-debt-accounting` through `bun run verify`.
Lens: ratchet · Area: baseline · Severity: high · Size: M · Confidence: high
Theme: baseline-integrity · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
The baseline's `configHash` deliberately covers only the ratchet's configuration — it excludes `items` — and baseline validation checks item *shape* only. So a change can introduce a new violation AND hand-edit the matching per-file `count` up by one in the same diff: the symmetric gate then compares new reality (N+1 findings) against the edited baseline (N+1 floor), finds zero drift, and passes. No `--allow-worse`, no `--reason`, no debt-log entry — the entire accountability layer (`lint-ratchet.debt-log.jsonl`) is bypassed by editing one digit. For an agent-heavy workflow this is exactly the "make the gate green" shortcut a coding agent under pressure will discover, and nothing catches it: the hand edit trivially preserves the deterministic byte format (a count digit change keeps sorted keys and 2-space indentation), and pre-commit/CI both run the same symmetric comparison against the same edited file.

## Evidence
- `/workspace/scripts/lint-ratchet/baseline-hash.ts:108-120` — `configHashInput` covers `files/ignores/metric/mode/ruleId/ruleOptions/target` (+source); `items` is excluded. Verified as claimed.
- `/workspace/scripts/lint-ratchet/baseline-validation.ts:53-61` — items validated only via `validateMetricItem` (shape); `:165-167` — the byte-determinism check a digit edit survives.
- `/workspace/scripts/lint-ratchet/modes.ts:120-143` — default gate: `compareCurrentToBaseline` against the committed file; edited-floor == current-reality ⇒ 0 regressions, 0 improvements, exit 0.
- `/workspace/scripts/lint-ratchet/baseline-update-apply.ts:84-93` — the debt log is written ONLY on the `--update --allow-worse` path; a hand edit never touches it.
- Debt-log schema carries what the check needs to match against: entry field is `regressions` (`debt-log-schema.ts:14-19`), each with `testId`, `ruleId`, `path`, `baselineCount`, `currentCount`, `reason` (`debt-log-regression-schema.ts:142-175`). Verified field names.
- `docs/guides/lint-ratchet.md:560-575` — enforcement of the debt log "stays local by design — there is no CI commitlint gate for the log"; this leaf closes that stated gap for the increase direction.

## Proposed direction
Add a diff-aware integrity check (new mode `lint:ratchet:check-debt-accounting` or folded into CI + the pre-commit ratchet slot): compare the committed baseline against the merge-base version (`git show $(git merge-base HEAD origin/main):lint-ratchet.baseline.json`, falling back to the parent commit locally). For every per-(testId, path) increase — count up, `lines` up, `maxComplexity` up, or new path — require a debt-log line appended *in the same range* whose `regressions[]` contains a matching `(testId, path)` with `currentCount` ≥ the new baseline count. Exemptions, all derivable from the same two snapshots: (a) test ids absent at merge-base (new ratchet adoption legitimately captures debt with no acceptance — `docs/guides/lint-ratchet.md#commands`), (b) entries whose `configHash` changed (scope/options changed; the floor is not comparable — the `--allow-worse` path still logs the cases that matter via `decideLintRatchetUpdate`). No new state: baseline history + union-merged debt log already contain everything.

## Scope / caveats
- This does not prevent hand edits; it makes an unaccounted *increase* fail loudly. Hand-editing a count *down* already fails naturally (reality > floor ⇒ regression).
- Where to run: CI is the trust boundary (local hooks are bypassable by the same actor who hand-edits); add to `.github/workflows/ci.yml` next to the existing ratchet steps (`:79-85`), and optionally to the pre-commit ratchet slot for fast feedback.
- Merge-base selection needs care on the protected-branch push itself (compare against first parent) and in worktrees without `origin/main`; keep the fallback chain explicit and tested.
- One commit: the check script + tests + CI step. If pre-commit wiring drags in verify-slot plumbing, split that into a follow-up commit.
