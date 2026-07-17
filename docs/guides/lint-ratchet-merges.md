# Lint Ratchet Merge Runbook

This runbook covers generated-baseline merge drivers, truth-up hooks, and
conflict recovery. For ratchet setup, commands, and baseline lifecycle, return
to the [main lint-ratchet guide](lint-ratchet.md); for metrics and adoption
patterns, see the [Lint Ratchet Reference](lint-ratchet-reference.md).

Musi commits several generated baseline files, each with its own git merge
driver. The subsections below separate the ratchet's own merge handling — the
part an adopting repo copies — from Musi's three other generated baselines
(knip unused-exports, near-duplicate pairs, and max-lines exceptions) and the
install, truth-up, and recovery machinery all four share.

## Ratchet baseline: portable merge handling

This is the copy-this part: the merge behavior and conflict recipe for
`lint-ratchet.baseline.json`, plus the append-only debt log it shares with
`--allow-worse`. Its driver is installed and its truth-up hooks run through the
shared machinery described further below.

The committed generated baseline files declare explicit merge semantics in
`.gitattributes`, because their correct merge behavior differs by file:

- `/lint-ratchet.debt-log.jsonl merge=union` — the log is append-only JSONL
  where every line is an independent record, so a union merge that keeps both
  sides' lines is always correct. The relative order of the two sides'
  appended entries is arbitrary; nothing reads the log positionally.
- `/lint-ratchet.baseline.json merge=lint-ratchet-baseline` — the baseline is
  derived from the source tree, so no textual merge of two baselines is ever
  correct. The custom driver first attempts a three-way semantic merge. It
  keeps one-sided ratchet entry changes from either side, and when both sides
  changed the same ratchet entry with matching metadata it uses item-level base
  semantics: a one-sided new path survives, a base path missing on one side is
  treated as drained, and a path present on both sides takes the lower floor. If that
  semantic merge cannot resolve safely, the driver falls back to the manual
  resolution recipe, keeps the 'ours' side in the working tree (still valid
  JSON, never conflict markers), and declares a conflict.

After a completed merge touches `lint-ratchet.baseline.json`, the post-merge
hook runs a cheap baseline truth-up and escalates to
`bun run lint:ratchet:check-baseline` when preflight fails, when the semantic
merge driver left a strict-min truth-up marker, or when
`MUSI_RATCHET_POSTMERGE=full` is set. If that local advisory is skipped or
misses a bad merge result, CI remains the blocking backstop: pull requests and
pushes to `main` run `bun run lint:ratchet` and
`bun run lint:ratchet:zero-baseline`.

When the lint-ratchet, knip, or near-duplicates driver falls back and creates a baseline conflict,
never hand-edit the file. The kept version is only a placeholder; the real
resolution is regeneration against the merged tree. The lint-ratchet driver
prints this same recipe when the conflict is created. The block below is
generated from the driver's own `print_conflict_recovery` case by
`bun run docs:baseline-conflict-recipes`, so the runbook and
`scripts/git/baseline-merge-driver.sh` never drift:

<!-- lint-ratchet-baseline-conflict-recipe:start -->
```text
lint-ratchet baseline conflict: lint-ratchet.baseline.json is generated, so do not hand-merge it.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other (non-baseline) conflict first, then run:
  bun run lint:ratchet:update

Then inspect the baseline diff against both sides:
  git diff HEAD -- lint-ratchet.baseline.json
  git diff MERGE_HEAD -- lint-ratchet.baseline.json

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

If the other side had lower floors, preserve them before adding the baseline
or explicitly accept the regression in the merge review.

Then run:
  git add lint-ratchet.baseline.json

If update asks for --allow-worse, the merged code regressed past the kept floor.
Fix the findings, or accept the debt with:
  bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"
```
<!-- lint-ratchet-baseline-conflict-recipe:end -->

Accepting the debt appends the acceptance to the union-merged debt log.

On fallback, keeping only the 'ours' side discards the other side's floors
before regeneration, so the update command compares only against the kept side.
That is why the both-sides baseline diff check above is part of the required
conflict recipe: when both sides locked improvements, reviewers need to confirm
the merged code preserved them or that any loss was intentional.

## Musi's other generated baselines (knip, near-duplicates, max-lines)

Musi applies the same baseline-merge pattern to three other generated files
that are **not** part of the ratchet copy set: the knip unused-exports,
near-duplicate pair, and max-lines exceptions baselines. They are documented
here so their machinery is not mistaken for the portable ratchet.

- `/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline`
  — the identity entries are the enforcement primitive and the summary is
  derived. The custom driver keeps disjoint drains from two branches by merging
  the shared remaining identities and regenerating a consistent summary. If
  that semantic merge cannot resolve safely, it follows the same generated-file
  fallback pattern: keep 'ours', print a repair recipe, and declare a conflict.
- `/sensor-near-duplicates.baseline.json merge=near-duplicates-baseline` —
  pair identities and counts are the no-new enforcement primitive. Routine
  checks gate only identities touching staged files, while full verification
  uses `--check-baseline` to compare the whole tree; `--update` performs the
  whole-repo scan and refuses additions, so the committed baseline can only
  shrink. A reviewed exception uses
  `bun scripts/sensor-near-duplicates.ts --admit "<identity>" --reason "<why>"`;
  the command admits only that currently detected identity and stores the
  non-empty reason on its baseline entry. For a rename or move, copy the new
  identity from the failed check and use `renamed from <old identity>` as the
  reason; the old identity drops while the replacement remains reviewable.
  Bare `--update` continues to reject all additions. The semantic merge leaves
  a truth-up marker whenever only one side changes the baseline, preserves
  distinct reasoned admissions from both sides, and intersects all other
  divergent debt sets so a dropped-but-still-live pair is reported after
  integration. A matching stamped marker authorizes
  `bun scripts/sensor-near-duplicates.ts --restore-merge-truth` to restore the
  exact detector output; unreasoned baseline growth remains blocked.

Generate an initial baseline for a new gate against the protected branch before
parallel feature work fans out. Identities introduced by the same feature pack
must then be fixed or recorded with the `--admit ... --reason ...` path; never
silently absorb them into the bulk initial baseline. Commit the source change
and its reasoned baseline entry together so review sees both sides of the
exception.
- `/eslint-config/max-lines-exceptions.baseline.json merge=max-lines-exceptions-baseline`
  — per-file exception entries are the enforcement primitive, while this
  baseline intentionally keeps hard-fail summary normalization. The custom
  driver uses base-aware configuration semantics: one-sided additions survive,
  one-sided removals drain an existing exception, and conflicting caps resolve
  to the lower value. It regenerates the summary so the structural max-lines
  gate accepts the result. If that semantic merge cannot resolve safely, it
  keeps 'ours' parseable and asks the resolver to reconcile both sides' entries
  before normalizing the derived summary.

After a completed merge touches `sensor-knip-unused-exports.baseline.json`, or
when the semantic driver left a truth-up marker, the knip post-merge hook runs
`bun run sensor:knip-unused-exports`. Entries remain the enforcement primitive,
but a stale derived summary now makes check mode fail with an `--update`
remediation so textual-merge drift cannot remain advisory forever. Update mode
regenerates the summary from the entries. If entry mismatch and summary drift
coexist, the entry-mismatch failure and the hook's stale-baseline instruction
take precedence over summary-drift messaging.

When the max-lines driver takes the lower of conflicting caps or sees a
retirement collide with a change, it leaves a truth-up marker. The max-lines
post-merge hook emits a local advisory to run full lint, repair the configured
caps, then run `bun run lint:max-lines-exceptions:update` and
`bun run lint:max-lines-exceptions`. The latter commands normalize and validate
the stored configuration; they do not prove by themselves that a merged cap is
high enough for the merged source.

Max-lines fallback is different: its entries are human-chosen caps, so
`bun run lint:max-lines-exceptions:update` normalizes entries and re-derives the
summary but does not regenerate entries from the merged tree. Inspect both
unmerged sides with
`git show :2:eslint-config/max-lines-exceptions.baseline.json` and
`git show :3:eslint-config/max-lines-exceptions.baseline.json`, then hand-edit
the kept file's entries to incorporate the other side's intended cap additions,
changes, and retirements. Do not hand-merge conflict markers. After reconciling
the configuration, run `bun run lint:max-lines-exceptions:update` to normalize
it and `bun run lint:max-lines-exceptions` to validate it before staging the
baseline. Confirm that the reconciled caps suffice for the merged source with
`bun run lint`, or rely on the full-lint commit gate before committing.

### Conflict recovery recipes the drivers print

When a driver falls back, it prints a baseline-specific recovery recipe. These
blocks are generated from the driver's own `print_conflict_recovery` cases by
`bun run docs:baseline-conflict-recipes`, keyed by baseline, so the runbook and
`scripts/git/baseline-merge-driver.sh` never drift (the lint-ratchet recipe
above is generated the same way).

knip unused-exports baseline:

<!-- knip-unused-exports-baseline-conflict-recipe:start -->
```text
knip unused-exports baseline conflict: sensor-knip-unused-exports.baseline.json is generated, so do not hand-merge it.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other (non-baseline) conflict first, then run:
  bun scripts/sensor-knip-unused-exports.ts --update

Then inspect the baseline diff against both sides:
  git diff HEAD -- sensor-knip-unused-exports.baseline.json
  git diff MERGE_HEAD -- sensor-knip-unused-exports.baseline.json

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

Then run:
  git add sensor-knip-unused-exports.baseline.json
```
<!-- knip-unused-exports-baseline-conflict-recipe:end -->

near-duplicates baseline:

<!-- near-duplicates-baseline-conflict-recipe:start -->
```text
near-duplicates baseline conflict: sensor-near-duplicates.baseline.json is generated, so do not hand-merge it.
Git kept the current side parseable. Resolve source conflicts, then run:
  bun scripts/sensor-near-duplicates.ts --update
Inspect the result against both sides before staging:
  git diff HEAD -- sensor-near-duplicates.baseline.json
  git diff MERGE_HEAD -- sensor-near-duplicates.baseline.json
```
<!-- near-duplicates-baseline-conflict-recipe:end -->

max-lines exceptions baseline:

<!-- max-lines-exceptions-baseline-conflict-recipe:start -->
```text
max-lines exceptions baseline conflict: eslint-config/max-lines-exceptions.baseline.json is a configuration ledger; do not hand-merge conflict markers.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other (non-baseline) conflict first, then inspect both sides' configured entries:
  git show :2:eslint-config/max-lines-exceptions.baseline.json
  git show :3:eslint-config/max-lines-exceptions.baseline.json

Hand-edit the kept file's entries to incorporate the other side's intended cap changes,
including additions and retirements.

Then normalize and validate the reconciled configuration:
  bun run lint:max-lines-exceptions:update
  bun run lint:max-lines-exceptions

Confirm the reconciled caps suffice for the merged source by running full lint:
  bun run lint
or rely on the full-lint commit gate before committing.

Then inspect the baseline diff against both sides:
  git diff HEAD -- eslint-config/max-lines-exceptions.baseline.json
  git diff MERGE_HEAD -- eslint-config/max-lines-exceptions.baseline.json

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

Then run:
  git add eslint-config/max-lines-exceptions.baseline.json
```
<!-- max-lines-exceptions-baseline-conflict-recipe:end -->

## Shared install, truth-up, and recovery mechanics

The driver install, marker-based truth-up execution, and conflict-recovery
steps below apply to all four generated baselines alike.
The `baseline:restore-stage` script used in Musi's conflict workflow is
repository-local tooling and is not part of the adopter copy set.

These patterns are anchored to the repo root so a same-named fixture committed
under a test directory never picks up these merge semantics. The driver fires
for every operation that uses the merge machinery, not just `git merge`. The
semantic merge rules are symmetric in the two sides, so rebase side-swapping
does not matter when the driver resolves automatically. The side-swap warning
still matters on fallback: during `git merge` and `git cherry-pick` the kept
'ours' side is the current branch, but during `git rebase` the sides are
swapped — the kept version is the upstream base, not the branch being rebased.

The repo installs the local driver config automatically from `prepare`, the
checkout/merge hooks, and `worktree:init`. Run the installer manually as the
recovery path if a clone predates that automation, package scripts were skipped,
or a health check reports stale local merge-driver state:

```sh
bun run lint:ratchet:install-merge-driver
bun run sensor:knip-unused-exports:install-merge-driver
bun run sensor:near-duplicates:install-merge-driver
bun run lint:max-lines-exceptions:install-merge-driver
```

Git does not load merge-driver commands from committed files; `.gitattributes`
only names the driver. The install scripts copy the drivers into the clone's
Git common directory, write `merge.lint-ratchet-baseline.*` and
`merge.knip-unused-exports-baseline.*` and
`merge.near-duplicates-baseline.*` and
`merge.max-lines-exceptions-baseline.*` to local Git config, and mirror the
baseline attributes into `.git/info/attributes`, replacing stale local
`*-baseline.json -merge` entries from transition windows. The installed
commands resolve the Git common directory at merge time, so linked worktrees do
not keep pointing at whichever checkout ran the installer.

Automatic installation follows the existing Husky `prepare` precedent for
local Git config writes: it is idempotent, silent when the installed driver,
config entries, and info-attributes block are already current, and degrades to a
warning rather than breaking dependency install. The checkout and merge hooks
rerun the same cheap check so pulling driver or attribute changes refreshes
local state before the next merge operation.

The committed `.gitattributes` entries expose all four generated baselines to
Git's merge-driver mechanism, but a checkout where hooks and `prepare` never
ran still lacks the clone-local driver commands. In that state, the knip,
near-duplicates, and max-lines baselines have the same latent textual-merge risk as the lint-ratchet
baseline; max-lines is especially strict because summary drift hard-fails its
gate. The merge-driver health checks and `bun run doctor` report the missing
local config.

Truth-up markers are stamped with the pre-merge `HEAD`, because `MERGE_HEAD` is
not available while Git invokes merge drivers. The truth-up hooks honor a marker
only when that stamp matches the completed commit's first parent (`HEAD^1`). The
lint-ratchet, knip, and near-duplicates hooks consume it only after successful verification;
confirmed stale/corrupt results and environment failures keep it for another
capable retry at the same HEAD. A matching marker left by cherry-pick or rebase is actionable,
so `post-commit` runs the same truth-up or advisory with `HEAD^1` as its diff
base. Genuinely mismatched markers, such as residue from an aborted merge, are
ignored and removed on the next hook run. If an aborted merge's stamp still
matches the next commit's parent, the hook conservatively runs the truth-up.

The same truth-up runs from two hooks. An auto-committed merge is handled by
`post-merge`. A squash merge also fires `post-merge`, but because `HEAD` has not
moved yet that invocation deliberately leaves truth-up markers untouched; the
eventual one-parent squash commit handles them through `post-commit`. A merge
completed with a plain `git commit` — after `git merge --no-commit`, or after
resolving a conflicted merge by hand — also fires `post-commit`, so
`.husky/post-commit` re-runs the truth-up in "post-commit" context. It gates
cheaply (a merge commit has a second parent, or a marker is pending) and, like
`post-merge`, honors a matching stamp or, for the ratchet and knip baselines, a
merge that touched the baseline. Exactly one successful verifying hook consumes
any given lint-ratchet, knip, or near-duplicates marker. A
marker left behind by `git merge --abort` is consumed at the next commit rather
than lingering until the next merge: a matching stamp is conservatively
honored, while a mismatched one prints `ignoring stale`. The lint-ratchet and
knip truth-ups announce the check they run (`… truth-up running …`) and confirm
a clean result (`… verified truthful.`) so a successful ~20s check is not
silent; the marker-only max-lines hook performs no verification, prints its
one-shot advisory, and consumes the matching marker because it has no success
result to retry. If lint-ratchet, knip, or near-duplicates verification cannot run because `bun` or
its check environment is unavailable, the hook leaves the matching marker in
place. Another capable hook invocation can retry it while `HEAD` is unchanged;
after a later commit moves `HEAD`, the stamp check instead discards it legibly
with `ignoring stale`. The same stale-stamp cleanup retires markers retained after
a failed verification once a repair or unrelated follow-up commit moves HEAD.

When the semantic merge succeeds, Git uses the merged baseline and continues.
For all four baselines, the post-merge truth-up is the local backstop for cases
where strict merge semantics can be stale against the merged source tree. Run
the hook's repair commands and commit the repaired baseline as a follow-up
commit, or amend the merge if your workflow permits history rewriting, when it
reports a stale or potentially insufficient baseline.

For a stale near-duplicates result with a matching truth-up marker, run
`bun scripts/sensor-near-duplicates.ts --restore-merge-truth`, inspect and stage
the regenerated baseline, then commit it. The marker authorizes only the exact
whole-tree detector truth and remains available for that follow-up commit gate;
`--update` deliberately cannot restore identities dropped by the merge.

If a baseline conflict contains `<<<<<<<` markers or Git did not print the
driver guidance, the clone is missing the local driver config or has stale
`.git/info/attributes`. This applies to all four generated baselines; run the
matching installer, restore the still-in-progress placeholder from stage 2 with
`baseline:restore-stage --ours`, then regenerate with that baseline's update
command:

- `lint-ratchet.baseline.json`:
  `bun run lint:ratchet:install-merge-driver`, then
  `bun run baseline:restore-stage -- --ours lint-ratchet.baseline.json`, then
  `bun run lint:ratchet:update`.
- `sensor-knip-unused-exports.baseline.json`:
  `bun run sensor:knip-unused-exports:install-merge-driver`, then
  `bun run baseline:restore-stage -- --ours sensor-knip-unused-exports.baseline.json`,
  then `bun scripts/sensor-knip-unused-exports.ts --update`.
- `sensor-near-duplicates.baseline.json`:
  `bun run sensor:near-duplicates:install-merge-driver`, then
  `bun run baseline:restore-stage -- --ours sensor-near-duplicates.baseline.json`,
  then `bun scripts/sensor-near-duplicates.ts --update`.
- `eslint-config/max-lines-exceptions.baseline.json`:
  `bun run lint:max-lines-exceptions:install-merge-driver`, then
  `bun run baseline:restore-stage -- --ours eslint-config/max-lines-exceptions.baseline.json`,
  then reconcile its entries from stages 2 and 3 before running the update and
  validation commands from the max-lines fallback recipe above.

That stage-2 restore assumes the conflict is still in progress. Always restore
stage 2 with `--ours`. During rebase Git swaps the sides, so stage 2 is the
upstream base, not the branch being rebased. After regenerating, inspect the
baseline diff against both sides as described above; preserve any lower floor
from the other side or explicitly accept the regression before staging.

If the marker-ridden baseline was already **committed** (the conflict is no
longer in progress, so `git ls-files -u` is empty), `baseline:restore-stage`
refuses with "no merge, cherry-pick, or rebase conflict is in progress" and the
update command re-throws the same tripwire, because there are no index stages
left to restore. Recover a parseable version from a parent commit instead, then
regenerate. This applies to all four baselines — substitute the file and update
command for the one you hit:

```text
# lint-ratchet.baseline.json
git show HEAD^:lint-ratchet.baseline.json > lint-ratchet.baseline.json
bun run lint:ratchet:update

# sensor-knip-unused-exports.baseline.json
git show HEAD^:sensor-knip-unused-exports.baseline.json > sensor-knip-unused-exports.baseline.json
bun scripts/sensor-knip-unused-exports.ts --update

# sensor-near-duplicates.baseline.json
git show HEAD^:sensor-near-duplicates.baseline.json > sensor-near-duplicates.baseline.json
bun scripts/sensor-near-duplicates.ts --update

# eslint-config/max-lines-exceptions.baseline.json
git show HEAD^:eslint-config/max-lines-exceptions.baseline.json > eslint-config/max-lines-exceptions.baseline.json
bun run lint:max-lines-exceptions:update
```

Use `git restore --source=<good-commit> -- <file>` instead of `git show` when
the last good copy is further back than the first parent. For max-lines, hand
back in any cap changes the merge dropped before regenerating (its update
normalizes but does not re-derive entries from the tree).

Merge attributes are read from the tree that is checked out, not from the
branch being merged in, so branches created before the `.gitattributes`
entries existed do not honor them when merged *into*. The install script's
`.git/info/attributes` mirror applies to every operation in the clone regardless
of checkout, as long as the installer has been run after the relevant merge
attribute changes landed.
