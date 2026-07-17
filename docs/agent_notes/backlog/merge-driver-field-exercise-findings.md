# Merge-driver field exercise — findings

Status: Done (2026-07-16). Adversarial real-merge validation of the semantic
lint-ratchet baseline merge driver (`scripts/lint-ratchet/baseline-merge.ts`,
landed `e8b9f7db`, hardened `6a0106df`). Executed as drain leaf 2.2; mission
spec in [`merge-driver-field-exercise.md`](./merge-driver-field-exercise.md).

## How the exercise was run

Every scenario ran in throwaway clones of this repo (`git clone /workspace`),
never in the primary worktree. Two tiers:

- **Driver-engagement tier** — a clone with the driver installed via
  `bash scripts/git/install-lint-ratchet-merge-driver.sh` (the semantic merge
  chain imports only Node builtins + in-repo files, so it runs without
  `bun install`). Conflict classes were manufactured with structurally valid
  synthetic baselines (`ratchet/<name>` ids, real `sha256:<64hex>` hashes) so
  each class could be isolated and the merged floors read back exactly. Real
  merges, real `git rebase`, and real `git cherry-pick` drove the driver
  through its actual Git plumbing.
- **Truth-up / preflight tier** — a clone with a real `bun install` and the
  husky hooks active, exercising the real `lint-ratchet.baseline.json` against
  the real source tree so `check-baseline`, `post-merge-baseline-preflight.ts`,
  and the post-merge truth-up hook fired for real.

A first pass used synthetic baselines with placeholder ids/hashes; the driver
correctly **rejected them as unparseable and fell back** — a useful reminder
that the driver validates structure (`ratchet/<name>`, sha256 hashes) before it
will merge, and that malformed inputs get the manual-resolution recipe, not a
silent merge. All results below use valid inputs.

## Conflict-class results

| Class | What the driver did | Contributor experience | Verdict |
|---|---|---|---|
| **Driverless clone** (no driver in `.git/config` yet) | Git silently falls back to its built-in text merge (the tracked `.gitattributes` names `merge=lint-ratchet-baseline`, but the driver is undefined until install). Overlapping edits ⇒ **conflict markers written into the generated JSON**; disjoint edits ⇒ clean-but-unsemantic text merge, no truth-up marker. | Broken JSON in a generated file. Caught reactively: `parseLintRatchetBaselineStructure`'s `CONFLICT_MARKER_TRIPWIRE` rejects the file on the next `check-baseline`/preflight with the exact recovery recipe (install driver, `baseline:restore-stage`, regenerate). CI (`lint:ratchet`) is the blocking backstop. | **Rough but guarded** — see fix leaf below |
| **Cross-rule** (each side drains a different rule) | Resolves at the *test* level: the side equal to base is discarded, the changed side's whole test is taken, for each rule independently. Both drains preserved. No item merge, **no truth-up marker**. | Invisible, clean auto-merge. | **Clean** |
| **Same-rule, different files** (the class per-rule sharding could not fix) | Item-level merge: one file's floor lowered, another file's entry removed — both drains preserved. Truth-up marker set. | Clean auto-merge; post-merge hook re-verifies. | **Clean** (headline case) |
| **Same file, different counts** | Keeps the lower floor; truth-up marker set. | Clean; re-verified post-merge. | **Clean** |
| **Same file, same count, fingerprint churn** | Keeps the count, picks the deterministic (lower) `messagesFingerprint`, sets truth-up marker so the real fingerprint is re-derived post-merge. | Clean; re-verified. | **Clean** |
| **Regression vs drain** (one side `--allow-worse`) | Min-merge keeps the **lower** (drain) floor and discards the accepted-regression higher floor; truth-up marker set. The `--allow-worse` debt-log line union-merges independently and survives. | Clean auto-merge, but the merged floor now sits below the recorded acceptance until truth-up runs; `check-baseline` re-derives from the merged source and, if the regression's findings really remain, reports "worse" and demands `--update`. | **Clean** (self-correcting; debt-log seam examined — no defect, see notes) |
| **One-sided new path** (no base entry) | Survives from whichever side introduced it; no truth-up when base absent. | Clean. | **Clean** |
| **Retirement vs change** (one side removes the whole ratchet, other drains it) | **Unresolvable** → fallback: keeps `ours`, prints the recovery recipe, exits 1. | A real conflict the contributor must resolve by regenerating; message is explicit ("one side removed the ratchet while the other changed it"). | **Correct** (human regen required) |
| **Hand-edited metadata vs generated update** (configHash / ruleSourceHash / files differ between sides) | **Unresolvable** → `"<id>: ratchet metadata differs between sides; regenerate the baseline after resolving other conflicts"`, fallback keeps `ours`, exits 1. | Explicit instruction to regenerate; the driver refuses to item-merge across a metadata mismatch. | **Correct** (this is the hand-edit integrity interaction at merge time) |

## Does the driver fire on rebase and cherry-pick?

**Yes — confirmed empirically for both.** A `git rebase` and a `git cherry-pick`
of a baseline-touching commit each invoked the semantic driver: the merged floor
was the min of the two sides and a truth-up marker was written, identical to the
`merge` path. The marker records `pre-merge-head=<pre-op HEAD>`, which equals the
resulting one-parent commit's `HEAD^1`, so the `post-commit` truth-up path honors
it (and the `atomic-write.ts` stamp logic discards markers leaked onto unrelated
commits). Custom merge drivers are **not** bypassed by rebase/cherry-pick here.

## Truth-up marker, preflight, and check-baseline (exercised for real)

- The driver writes `.git/musi/lint-ratchet-baseline-postmerge-truth-up-required`
  with the pre-merge HEAD stamp whenever the two sides' item sets diverge.
- **STALE path (observed):** a real merge that lowered a floor below the source
  truth left the marker; the post-merge hook escalated to `check-baseline`, which
  reported `lint:ratchet: current findings are worse … count increased from 2 to
  4` (exit 1 with the `lint:ratchet:` verdict marker); the hook printed the
  STALE_BASELINE_INSTRUCTION ("run bun run lint:ratchet:update, review the diff
  against HEAD^1 (and HEAD^2 for a merge commit)…") and **kept** the marker
  (consume-only-on-success).
- **VERIFIED path (observed):** on a truthful baseline `check-baseline` returns
  exit 0 ("OK — 448 current findings") and preflight returns exit 0.
- **FAILED-CHECK path (observed):** when `check-baseline` could not evaluate (a
  missing dependency in the sandbox produced exit 1 *without* the `lint:ratchet:`
  marker) the hook correctly classified it as an environment failure — surfacing
  the real error rather than falsely claiming staleness — and kept the marker.
- **Preflight as the cheap hand-edit gate (observed):** `post-merge-baseline-preflight.ts`
  returns exit 0 on a valid baseline and **exit 1 on a hand-edited stale
  `ruleSourceHash`** (`"…ruleSourceHash is stale (run bun run lint:ratchet:update
  to regenerate)"`). So a hand-edited baseline that passes the driver's structural
  gate is still caught post-merge: preflight failure sets `run_full_check=1` and
  escalates to `check-baseline`.

Net: the marker → preflight → check-baseline → advisory chain works end to end,
and every classification branch (stale / verified / could-not-run) behaves as
designed.

## Debt-log vs min-merge floor (seam examined, no defect)

The regression-vs-drain class raised a question: the union-merged debt log can
record an `--allow-worse` acceptance at a floor the min-merge discarded. Examined
and found benign — the debt log is append-only *history*, not current state;
`--check-debt-accounting` counts baseline **increases** against log entries, and a
min-merge produces a **decrease**, so it is not triggered, while `check-baseline`
re-derives current findings from the merged source and blocks if the regression
truly remains. No inconsistency the tooling fails to catch.

## Per-rule sharding linkage (required record)

**The exercise produced NO new evidence that reopens the per-rule baseline
sharding won't-do.** The decision is recorded in
[`arch-review-2026-07/12-baseline-framework-and-max-lines.md`](./arch-review-2026-07/12-baseline-framework-and-max-lines.md)
(Corrections, 2026-07-02: per-rule sharding "dropped … won't-do … Do not reopen
without new evidence that the driver is insufficient"). The standalone file it
cites, `harness-review-2026-07/13-baseline-sharding-per-ratchet.md`, does not
exist in the tree — the verdict lives in arch-review 12.

The driver proved **sufficient** in exactly the case sharding was meant to
address: the **same-rule-different-files** collision merged cleanly (the class
"per-rule sharding cannot fix", per arch-review 12). Every other resolvable class
merged correctly; the only unresolvable classes (retirement-vs-change,
metadata-drift) are inherent to any single-file *or sharded* baseline
representation and sharding would not help. **Sharding stays closed (won't-do).**

## Fix / improvement leaves filed

- [`merge-driver-driverless-window-guard.md`](./merge-driver-driverless-window-guard.md)
  — low-priority/optional: the fresh-clone-before-first-`bun install` merge window
  (driverless case). Reactively guarded today (tripwire + CI); the leaf captures
  the evidence and weighs a proactive guard against Git's inherent inability to
  hard-fail on an undefined-but-mapped merge driver.

No other rough or broken behavior was found: the semantic driver resolves every
resolvable collision class correctly, falls back safely with an actionable recipe
on the two genuinely unresolvable classes, and engages on merge, rebase, and
cherry-pick alike.
