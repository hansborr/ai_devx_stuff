# Handoff: Fast-Commit Toggle + Merge Gate

**Status:** design approved, not yet implemented.
**Branch to use:** `feat/fast-commit-toggle`
**Author of note:** prior session (design + recon done; no code written yet).

---

## 1. Why

We want to run autonomous workflows that produce many commits quickly. The
per-commit gate (`.husky/pre-commit` → `verify:changed`) re-runs slow checks on
every commit. The two slow slots are **`test`** (`test:changed`) and
**`scripts`** (`test:scripts:changed`). The fast static checks (lint, ratchet,
zero-baseline, coverage-map, format-check, **typecheck**) are worth keeping per
commit so breakage still localizes.

Goal: an **opt-in, inert-by-default toggle** that skips only the slow test slots
in pre-commit, plus a **real merge gate** that runs full `bun run verify` before
landing to main. Net loop:

> feature branch → fast commits (toggle on) → `land.sh` runs full verify → `git merge --no-ff` into main

The toggle must be trivial to switch off and leave nothing to clean up.

---

## 2. Hard constraints (discovered — do not relearn these the hard way)

1. **No local bypass exists, by design.** `scripts/ai-hooks/policy.sh:188`
   (`ai_policy_violation_reason`) hard-blocks any Bash command containing
   `--no-verify`, `HUSKY=0`, or `git commit -n…`. It's enforced by a PreToolUse
   hook that scans **every** Bash command, so even a `grep` whose text contains
   those literals is rejected. `ai_preflight_or_block` (policy.sh:327) has **no
   env/touchfile escape hatch**. ⇒ Do not try to bypass; do not put those
   literals in shell commands you run.

2. **The changed-gate rejects unstaged/untracked source-relevant files**
   (`musi_changed_gate_fail_if_unstaged`). So the toggle cannot be an untracked
   file in the working tree — it must live **inside `.git/`**. Use
   `git rev-parse --git-common-dir` (repo-wide; matches `scripts/db-status.sh`
   convention).

3. **There is no merge gate today.** No `pre-push`, no `pre-merge-commit` hook.
   `git merge --no-ff` skips pre-commit entirely (see the `.husky/pre-commit`
   header comment). This is *why* we both add `land.sh` and can use `--no-ff` to
   land the feature cheaply (see §6).

4. **The pre-commit step list is generated**, not hand-written:
   `harness.controls.json` (consumer `hook/pre-commit`, `$.controls[95]`) →
   `bun run verify:steps` → `scripts/verify/steps.generated.sh`, validated by
   `bun run verify:steps:check`. **Do not edit `steps.generated.sh` directly.**
   We are *not* changing the manifest for this feature — the skip happens at
   resolution time (§4.1), so the generated file is untouched.

5. **commitlint ignores merge commits** (default `Merge …` messages pass — repo
   history has `Merge branch '…'` commits). So `land.sh`'s `--no-ff` merge
   commit will not trip the `commit-msg` hook.

---

## 3. Design overview

Three code changes + tests. Minimal footprint: **two existing files edited, one
new script, two existing test files extended.** No hook edits, no manifest edit.

| Change | File | Purpose |
|---|---|---|
| Skip `test`+`scripts` slots when toggle on | `scripts/verify/steps-lib.sh` | the actual fast mode |
| Make the success-marker fingerprint mode-aware | `scripts/lib/verify-metadata.sh` | prevent a fast run's marker from short-circuiting a later *normal* commit |
| Merge gate | `scripts/land.sh` (new) | full verify → `--no-ff` into main |

The pre-commit hook needs **no change**: it already treats
`MUSI_VERIFY_SLOT_SKIP_RC` as "skip this slot" (`.husky/pre-commit` step loop:
`if [ "$resolve_rc" -eq "$MUSI_VERIFY_SLOT_SKIP_RC" ]; then continue; fi`). The
`scripts` slot already uses this path for classifier-uncertainty, so skipping is
a proven, supported behavior.

**Critical scoping rule:** the skip is gated on `consumer == pre_commit` ONLY.
`bun run verify` / `verify:changed` (consumers `verify`, `verify_changed`) must
ALWAYS run `test`+`scripts`, even when the toggle is on — that is what keeps the
merge gate trustworthy.

---

## 4. Implementation detail

### 4.1 Skip the slow slots — `scripts/verify/steps-lib.sh`

Add a helper and an early-return in `musi_resolve_slot_cmd` (currently at
`steps-lib.sh:107`). The env override exists so tests can point at a temp file
without a real `.git`.

```bash
# Returns 0 if fast-commit mode is on (slow pre-commit test slots skipped).
# MUSI_FAST_COMMIT_MARKER overrides the path (tests); default lives in .git so it
# is never tracked and never trips the changed gate.
musi_fast_commit_enabled() {
  local marker="${MUSI_FAST_COMMIT_MARKER:-}"
  if [ -z "$marker" ]; then
    local common_dir
    common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
    marker="$common_dir/musi-fast-commit"
  fi
  [ -f "$marker" ]
}
```

Then at the top of `musi_resolve_slot_cmd`, after `key="$consumer:$slot"`:

```bash
  if [ "$consumer" = "pre_commit" ] && musi_fast_commit_enabled; then
    case "$slot" in
      test|scripts)
        printf 'verify steps: fast-commit mode — skipping %s slot (rm "$(git rev-parse --git-common-dir)/musi-fast-commit" to disable)\n' "$slot" >&2
        MUSI_RESOLVED_SLOT_CMD=()
        return "$MUSI_VERIFY_SLOT_SKIP_RC"
        ;;
    esac
  fi
```

That's the whole skip. Other slots resolve unchanged; other consumers unaffected.

### 4.2 Mode-aware fingerprint — `scripts/lib/verify-metadata.sh`

`ai_precommit_fingerprint` (`verify-metadata.sh:296`) hashes HEAD + staged diff +
tracked/untracked source files. Add the toggle's presence to the digest input so
a fast-mode run and a normal run at the same HEAD/diff produce **different**
fingerprints. This stops a normal commit from reusing a fast-mode success marker
(120s short-circuit) and trusting checks that didn't run.

Inside the `{ … } | sha256sum` block (e.g. right after the HEAD line at :300),
add:

```bash
    if [ -f "$(git -C "$repo_root" rev-parse --git-common-dir 2>/dev/null)/musi-fast-commit" ]; then
      printf 'fast-commit=1\n'
    fi
```

When the toggle is off the line is absent ⇒ fingerprint is **byte-identical to
today** (backward compatible). Direction of safety:
- fast marker (has `fast-commit=1`) vs later normal commit (no line) → no match → normal commit re-runs full ✓
- fast vs fast → match → short-circuit ✓ (both partial, fine)
- prior full manual-verify marker vs fast commit → no match → fast commit runs fast checks ✓

No pre-commit hook edit needed for marker safety — the fingerprint divergence is
sufficient.

### 4.3 Merge gate — new `scripts/land.sh`

```bash
#!/usr/bin/env bash
# Land the current feature branch into main behind a FULL verify gate.
# Usage: bash scripts/land.sh   (run from the feature branch worktree)
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

branch="$(git symbolic-ref --short HEAD)"
case "$branch" in
  main|master) echo "land: already on $branch — run from a feature branch." >&2; exit 1 ;;
esac
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "land: uncommitted changes — commit or stash first." >&2; exit 1
fi

echo "land: running full verify on $branch …"
NODE_OPTIONS="--max-old-space-size=6144" bun run verify   # full = always runs test + scripts

echo "land: verify passed — merging $branch into main (--no-ff, skips pre-commit by design)"
git switch main
git merge --no-ff "$branch"
echo "land: merged $branch → main. Review, then push when ready (push is NOT automatic)."
```

Notes for the implementer:
- Full `verify` is intentionally sequential (failures actionable one at a time).
- Heap bump mirrors the known full-gate OOM-at-4GB issue.
- Leave `git push` to a human — do not push.
- Single-worktree assumption (`git switch main`). If you support sibling
  worktrees, harden accordingly, but don't block the first cut on it.

---

## 5. Tests (TDD — write these first)

Prefer **extending existing smoke tests** over new `test-*.sh` files. A new
`scripts/tests/test-*.sh` must be registered in **three** places or the
changed-gate/fixtures fail: `scripts/path-policy/path-policy-smoke-subjects-data.ts`,
`scripts/path-policy/path-policy-query.test.ts` (run-order), and
`scripts/tests/test-test-scripts.sh` (`ALL_SMOKE_TESTS`). Avoid that overhead.

1. **Resolver skip** — extend `scripts/tests/test-verify.sh` (already registered,
   already sources `steps.generated.sh` + `steps-lib.sh`). With
   `MUSI_FAST_COMMIT_MARKER` pointed at an existing temp file:
   - `musi_resolve_slot_cmd pre_commit test` returns rc `100` (`MUSI_VERIFY_SLOT_SKIP_RC`).
   - `musi_resolve_slot_cmd pre_commit scripts` returns rc `100`.
   - `musi_resolve_slot_cmd pre_commit typecheck` returns rc `0` and resolves a command.
   - `musi_resolve_slot_cmd verify_changed test` returns rc `0` (other consumers unaffected).
   - With the marker absent, `pre_commit test` resolves rc `0` (default behavior intact).

2. **Fingerprint divergence** — extend `scripts/tests/test-verify-metadata.sh`
   (already registered, already exercises the fingerprint). Assert
   `ai_precommit_fingerprint "$repo"` differs with vs without the
   `musi-fast-commit` file present, and equals the legacy value when absent.

3. **land.sh guards** (light) — refuses on `main`; refuses with a dirty tree.
   Don't run the real heavy `verify` in a unit test; stub `bun`/PATH or assert
   the guard branches only.

---

## 6. Landing strategy

1. `git switch -c feat/fast-commit-toggle`.
2. TDD: failing tests → implement §4 → green.
3. Stage intended changes, then `bun run verify:changed`. Expect possible
   complaints from adding `scripts/land.sh`:
   - `docs:lint-coverage-map:check --staged` may want a coverage-map row for the
     new script — follow its guidance.
   - shellcheck on the new/edited `.sh`.
   - path-policy classification of `scripts/land.sh`.
4. Commit on the feature branch. This commit touches hook-adjacent libs, so the
   pre-commit full path may be heavy/flaky (known: full eslint OOMs at 4GB →
   `NODE_OPTIONS=--max-old-space-size=6144`; eslint-config-plugin /
   test-dependency-freshness can flake). If it flakes, land via a fresh
   sequential `verify` marker bridge (the project's standard trick).
5. **Land via `git merge --no-ff feat/fast-commit-toggle` into main** — the merge
   skips pre-commit, so the heavy gate only ran once on the feature commit.
6. Do **not** push unless the human asks.

Also commit this handoff file (`docs/agent_notes/fast-commit-toggle-handoff.md`)
on the branch — right now it is untracked, and an untracked source-relevant file
will trip the changed-gate on unrelated commits.

---

## 7. Toggle usage (document in the PR description / AGENTS.md if desired)

```bash
# Enable fast-commit mode (skip test + test:scripts in pre-commit):
touch "$(git rev-parse --git-common-dir)/musi-fast-commit"

# Disable (restore full per-commit verification):
rm -f "$(git rev-parse --git-common-dir)/musi-fast-commit"
```

Default (file absent) = today's behavior, byte-for-byte. Nothing to revert later.

---

## 8. Acceptance checklist

- [ ] Marker **absent**: pre-commit runs all 8 slots exactly as before; fingerprint unchanged.
- [ ] Marker **present**: pre-commit runs lint, ratchet, zero-baseline, coverage-map, format-check, typecheck; **skips** test + scripts; prints the skip notice.
- [ ] `bun run verify` and `verify:changed` run test + scripts **regardless** of the marker.
- [ ] Two commits at the same logical state — one fast, then one normal (marker removed) — and the normal one re-runs full (no false short-circuit).
- [ ] `land.sh` refuses on main and on a dirty tree; on a clean feature branch it runs full verify then `--no-ff` merges into main.
- [ ] New tests pass; no new `test-*.sh` smoke file added (or, if unavoidable, registered in all three places).
- [ ] Landed to main via `--no-ff` merge; not pushed.

---

## 9. Out of scope / possible follow-ups

- Multi-worktree-aware `land.sh`.
- A one-liner `fast on|off` wrapper script for ergonomics.
- A pre-push backstop hook (belt-and-suspenders for humans who skip `land.sh`).
- Auto-clearing the toggle after a successful `land.sh`.
