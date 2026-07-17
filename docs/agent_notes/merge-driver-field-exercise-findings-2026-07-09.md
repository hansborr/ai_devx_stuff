# Merge-driver field exercise — findings, session 1 (2026-07-09)

Source leaf: `docs/agent_notes/backlog/merge-driver-field-exercise.md` (parked,
owner-requested). Scope this session (owner-selected "start small, then
decide"): the two core ratchet-driver conflict classes plus the knip driverless
class. Not yet run: regression (`--allow-worse`) collision, retirement
collision, hand-edited baseline, driverless clone, rebase/cherry-pick plumbing,
and a real fallback-recipe conflict (metadata mismatch).

Method: real scratch branches off main (`53e88504`), honest drains (real code
fixes followed by `lint:ratchet:update` / knip `--update`), real `git merge`
with all hooks live, in the primary worktree. Scratch branches (left in place;
force-delete is agent-blocked): `scratch/mfx-{a,b}-cross-rule`,
`scratch/mfx-{c,d}-same-rule`, `scratch/mfx-{e,f}-knip`,
`scratch/mfx-replay{,2,3}`.

## Class results

### 1. Two branches draining different rules (cross-rule) — PASS

A drained `strict-boolean-expressions-server-services` in
`character-create-spells.ts`; B drained
`local-no-arbitrary-tailwind-value-client` in `presence-indicator.tsx`.
Merge: silent, instant success ("Auto-merging lint-ratchet.baseline.json",
ort). No markers, no advisory. Verified truthful post-merge:
`lint:ratchet:check-baseline` OK at 434 findings (436 − 2). Contributor
experience is indistinguishable from a merge that never touched the baseline.

### 2. Two branches draining the same rule in different files — PASS on content, FAIL on safety net

C drained the same ratchet id in `combat-actions/apply-damage.ts`; D in
`level-up/asi.ts`. Merge (0.36 s): silent, correct — `mergeItems` unioned the
paths and dropped both drained items; a manual replay of the same three-way
through `baseline-merge-cli.ts` reproduced the committed result byte-for-byte
and reported `postMergeTruthUpRequired`. But in the real merge the truth-up
marker was never written and the post-merge full check never ran (finding F1).
Content happened to be truthful here; the net that exists for when min-merge
guesses wrong did not engage.

### 3. Knip baseline, driverless textual merge — FAIL exactly as predicted (silent corruption)

Branch e un-exported `isStringConcat`
(`scripts/codemods/structured-logging-fix-ast.ts`); branch f un-exported
`DEFAULT_CHURN_STANDOUT_FACTOR` (`scripts/drift-ai/hotspots-churn.ts`). Each
side honestly regenerated: count 189→188, exports 75→74, one entry removed.

Merge (`f3ff87e5`, exit 0, ~2 s): "Auto-merging … Merge made by the 'ort'
strategy." — no conflict markers, valid JSON, `git status` clean. `entries[]`
correctly absorbed both disjoint removals (187 real entries), but both sides'
`summary` edits were textually identical (189→188, 75→74), so git applied the
hunk once: committed summary says 188/74 against 187/73 reality. The knip
floor is disabled until repaired. `bun run sensor:knip-unused-exports` exits 2
with a precise derived-vs-committed message.

The loud-failure post-merge hook DID fire and printed the corrupt-baseline
advisory (correct mechanism, correct consequence, two remedies). But it is
stderr after a reassuring merge summary, on an already-created merge commit,
exit code 0. A contributor must notice it, trust it over "Merge made by", and
run the repair before their next push — otherwise CI is the first hard stop.

## Findings

### F1 (P1): `postMergeTruthUpRequired` escape hatch is dead code in real merges

`scripts/git/lint-ratchet-baseline-merge-driver.sh:43-52` only sets the marker
path when `git rev-parse --verify MERGE_HEAD^{commit}` succeeds *at driver
time*. Empirically (instrumented installed driver copy): `.git/MERGE_HEAD`
does not exist while the merge driver runs — git writes it after the strategy
finishes (or when a conflicted merge stops). So the shim passes an empty
marker path to `baseline-merge-cli.ts` on every real merge; the marker is
never written; the marker branch of
`lint-ratchet-post-merge-baseline-truth-up.sh:22-38` never fires. Every
min-merge resolution that needs re-verification (lower-count winner, dropped
path, fingerprint tie-break) currently completes with only the cheap
structural preflight; the full `check-baseline` truth-up never runs locally.
CI `lint:ratchet` remains the only backstop.

Why tests missed it: `baseline-merge-cli.test.ts` hands the CLI a MERGE_HEAD
sha directly; the shell smoke test validates installer/health-check wiring,
not a live `git merge` timeline. Unit-green, reality-dead — the exact seam
this exercise was commissioned to probe.

Fix-leaf candidate: always set the marker path and write the marker unstamped
when MERGE_HEAD is unavailable — the consuming hook already documents
always-honor semantics for unstamped markers. (Optionally stamp from `HEAD^2`
at hook time instead of driver time.) The same gate also means cherry-pick and
rebase can never stamp (`CHERRY_PICK_HEAD`/`REBASE_HEAD` are never consulted).

### F2: cross-environment fingerprint drift churns 21 unrelated baseline lines on every `--update`

On a clean main tree, `lint:ratchet:update` rewrites all 21
`messagesFingerprint` values under `ratchet/react-hooks-set-state-in-effect-client`
(counts unchanged; stable across reruns here → environment message drift, not
per-run nondeterminism). Consequences: (a) every contributor's baseline diff
carries unrelated churn; (b) when two contributors' environments differ,
same-count/different-fingerprint items exercise the driver's lexicographic
tie-break — which flags truth-up, which F1 currently swallows. Open question
for a follow-up: what feeds this fingerprint (message text? version skew?) and
why `check-baseline` passes on main when committed fingerprints differ from
locally computed ones.

### F3: driver crash degrades safely, but silently

A crashing driver (manufactured accidentally via instrumentation under
`set -e`) leaves the path conflicted (`UU`), valid 'ours' JSON in the working
tree, no conflict markers — the design promise holds. But the recovery recipe
only prints on the controlled exit-1 fallback path; a crash dies before the
recipe, leaving a conflicted generated file with no printed guidance.

### F4: advisories prescribe `git commit --amend`, which agent contributors cannot run

Both post-merge advisories (ratchet stale, knip stale/corrupt) end with
"then `git commit --amend`"; agent policy blocks amend (and rebase). Worth an
"or add a follow-up commit" alternative in the advisory text so agent
contributors don't stall or improvise.

### F5: knip merge advisory is post-hoc, easy to miss, and its "durable fix" is manual

The knip hook's message quality is high, but it prints after the merge commit
exists, with exit 0, and GUI/wrapped git clients may swallow hook stderr. The
"durable fix" it names — running `sensor-knip-unused-exports-merge-cli.ts` by
hand — is exactly the semantic merge that the deferred `.gitattributes` wiring
would automate. Class 3 is direct field evidence for the deferred wiring
decision (`arch-review-2026-07/12-baseline-framework-and-max-lines.md`
"Deferred (tracked follow-up)"): the corruption class it would prevent occurs
on the first pair of disjoint single-entry drains, i.e. the *common* case, not
an edge case.

## Linkage (required by the exercise spec)

- Per-rule sharding reopen gate
  (`harness-review-2026-07/13-baseline-sharding-per-ratchet.md`, closed
  won't-do): classes 1–2 confirm the driver's headline content claim, including
  the same-rule-different-files class sharding could not fix. No evidence to
  reopen; F1 is wiring, not algorithm. Gate stays closed.
- Knip `.gitattributes` wiring deferral (`arch-review-2026-07/12`): Class 3
  shows the driverless experience corrupts on the common disjoint-drain case
  and detection is advisory-only. This is the field evidence the deferral was
  waiting on; recommend promoting the wiring (plus F1's marker fix so the
  ratchet driver's own escape hatch works) to fix leaves.

## Remaining matrix (not yet run)

Regression collision (`--allow-worse` + debt-log union), retirement collision
(`--retire-ratchet` vs same-rule change → hard-failure recipe), hand-edited
baseline vs generated, driverless clone, rebase/cherry-pick plumbing (human
must drive rebase; agents are policy-blocked), and a real controlled fallback
(metadata mismatch) to observe the printed recipe end-to-end. Run these against
the fixed shims (see Outcomes below) — the truth-up path was dead during
session 1, so its classes were only half-observable.

## Outcomes (2026-07-09, same day)

The fix recommendations above were implemented the same day on
`fix/post-merge-truthup-marker-gate` (5 commits off `53e88504`,
`d8290585..70dd76bb`), reviewed by a GPT consult and an Opus subagent
(both: safe to land) with the one shared review finding fixed and re-verified.
Status per finding:

- **F1 FIXED** (`d8290585`, semantics revised in `70dd76bb`). The fix-leaf
  candidate above — write the marker unstamped, always-honor — was implemented
  first and then caught by both reviewers as a leak: merge drivers also run
  during cherry-pick, rebase, and aborted merges, where git never fires the
  post-merge hook, so an always-honored marker from those operations would
  force a spurious truth-up on the next unrelated merge (and the pre-existing
  "aborted merge" guard tests exercised an unreachable stamped path). Shipped
  semantics instead: the driver stamps the marker with the pre-merge `HEAD`
  (resolvable at driver time, equals the eventual merge commit's first
  parent); the post-merge hooks honor a marker only when `HEAD^1` matches the
  stamp and consume-and-report stale ones. Real cherry-pick-leak and
  real-`git merge` fixtures now pin the live timeline. Accepted residual: an
  aborted baseline merge re-attempted from the same `HEAD` with no intervening
  commit fires one harmless advisory truth-up.
- **F5 / Class 3 FIXED** (`db5ad2ce` + `4760ab9b`). The deferred knip
  `.gitattributes` wiring shipped end-to-end (attributes entry, driver shim,
  installer + health check, per-worktree auto-install, doctor/harness
  registration) with a real-merge fixture proving the disjoint-drain scenario
  now resolves to a consistent baseline. Defense-in-depth for driverless
  clones: `entries[]` is now authoritative for gating and a summary-only
  desync is a loud warning instead of a floor-disabling parse failure. One
  prose correction to Class 3: `44dedb74` (pre-session) had already made the
  sensor reject the corrupted baseline loudly — "silent" was accurate for the
  merge itself (exit 0), with detection deferred to the next sensor/CI run,
  not absent.
- **F4 FIXED** (`d670131c`). Both advisories now offer a follow-up-commit
  alternative to the agent-blocked `git commit --amend`.
- **F2 and F3 remain open** (fingerprint drift/churn incl. the check-baseline
  tolerance question; crashed driver prints no recovery recipe).
- Related owner ruling (2026-07-09): `max-lines-exceptions` keeps its
  hard-fail summary semantics (now divergent from knip's soft warn by
  design); instead it gets its own semantic merge driver via the same
  generic `scripts/lib/baseline/` machinery and the generalized installer
  plumbing.

---

# Session 2 — GPT second-opinion lane (`mfx2-x`)

Date: 2026-07-09. Pinned base: `d41d7fbc` on
`scratch/mfx2-x-base`. Scope: the owner-selected same-rule/different-files
lint-ratchet case in both merge orders, plus max-lines disjoint additions.
This session used real scratch branches, real source fixes or configuration
additions, the documented update commands, real commits with hooks enabled,
and real `git merge --no-ff` operations. No unit test stands in for a merge.

At startup the worktree was clean, the shared fast-commit marker remained in
place, and Git reported the intended attributes:

```text
lint-ratchet.baseline.json: merge: lint-ratchet-baseline
eslint-config/max-lines-exceptions.baseline.json: merge: max-lines-exceptions-baseline
```

The local Git config also contained both installed driver commands. All
scratch branches named below forked from `scratch/mfx2-x-base`; no protected
branch or another lane's scratch branch was checked out, changed, or merged.

## Scenario 1 — same rule, different files, both orders

### Setup

Both sides honestly drained one finding from
`ratchet/strict-boolean-expressions-server-services`:

- Combat side:
  `packages/server/src/services/combat-actions/apply-damage.ts`, changing the
  nullable-string condition from `targetCharacterId` truthiness to
  `targetCharacterId !== null`.
- Level-up side: `packages/server/src/services/level-up/asi.ts`, changing the
  nullable-number condition from `prereqs?.minimumLevel` truthiness to
  `prereqs?.minimumLevel !== undefined`.

Before the fixes, the ratchet's generated ESLint config reported verbatim:

```text
/home/node/persist/worktrees/workspace/mfx2-x/packages/server/src/services/combat-actions/apply-damage.ts
  19:38  error  Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly  @typescript-eslint/strict-boolean-expressions

/home/node/persist/worktrees/workspace/mfx2-x/packages/server/src/services/level-up/asi.ts
  115:7  error  Unexpected nullable number value in conditional. Please handle the nullish/zero/NaN cases explicitly  @typescript-eslint/strict-boolean-expressions

✖ 2 problems (2 errors, 0 warnings)
```

Each of the four fresh source branches ran the documented updater. It printed
the same result on every branch:

```text
$ bun scripts/lint-ratchet.ts --update
lint:ratchet:update OK — wrote lint-ratchet.baseline.json with 435 current finding(s).
```

The updater removed the selected path, but also reproduced session 1 F2: a
one-finding drain changed 21 unrelated `messagesFingerprint` values. The
baseline-only diff against the pinned base was 21 insertions and 25 deletions;
43 changed lines contained `messagesFingerprint` (42 lines for 21 replacement
pairs plus the removed finding's old fingerprint).

### Exact Git operations

Order 1, combat into level-up:

```sh
git switch -c scratch/mfx2-x-same-o1-combat scratch/mfx2-x-base
# fix apply-damage.ts; bun run lint:ratchet:update
git add packages/server/src/services/combat-actions/apply-damage.ts lint-ratchet.baseline.json
git commit -m 'fix(field-exercise): drain combat boolean finding' -m 'Create one honest side of the same-rule merge-driver field exercise with the generated baseline update.'

git switch -c scratch/mfx2-x-same-o1-level scratch/mfx2-x-base
# fix asi.ts; bun run lint:ratchet:update
git add packages/server/src/services/level-up/asi.ts lint-ratchet.baseline.json
git commit -m 'fix(field-exercise): drain level-up boolean finding' -m 'Create the other honest side of the same-rule merge-driver field exercise with the generated baseline update.'

git merge --no-ff scratch/mfx2-x-same-o1-combat \
  -m 'chore(field-exercise): merge combat drain into level branch' \
  -m 'Exercise the same-rule different-files merge driver in combat-into-level order.'
```

Order 2, level-up into combat, using a fresh pair:

```sh
git switch -c scratch/mfx2-x-same-o2-combat scratch/mfx2-x-base
# repeat the apply-damage.ts fix; bun run lint:ratchet:update
git add packages/server/src/services/combat-actions/apply-damage.ts lint-ratchet.baseline.json
git commit -m 'fix(field-exercise): repeat combat boolean drain' -m 'Create the fresh combat side required for the reverse-order same-rule field exercise.'

git switch -c scratch/mfx2-x-same-o2-level scratch/mfx2-x-base
# repeat the asi.ts fix; bun run lint:ratchet:update
git add packages/server/src/services/level-up/asi.ts lint-ratchet.baseline.json
git commit -m 'fix(field-exercise): repeat level-up boolean drain' -m 'Create the fresh level-up side required for the reverse-order same-rule field exercise.'

git switch scratch/mfx2-x-same-o2-combat
git merge --no-ff scratch/mfx2-x-same-o2-level \
  -m 'chore(field-exercise): merge level drain into combat branch' \
  -m 'Exercise the same-rule different-files merge driver in level-into-combat order.'
```

The source commits were `2cc5ea92`, `fade177e`, `137556fe`, and
`76693491`; the two merge commits were `3df6a2df` and `361450d0`.

### What Git, the driver, and hooks did

The semantic lint-ratchet driver resolved both branches' edits to the same
ratchet entry, preserved both source fixes, and dropped both independently
drained item paths. It produced byte-identical baselines in both orders.

Order 1 merge stdout was verbatim:

```text
Auto-merging lint-ratchet.baseline.json
Merge made by the 'ort' strategy.
 lint-ratchet.baseline.json                                  | 4 ----
 packages/server/src/services/combat-actions/apply-damage.ts | 2 +-
 2 files changed, 1 insertion(+), 5 deletions(-)
```

Order 2 merge stdout was verbatim:

```text
Auto-merging lint-ratchet.baseline.json
Merge made by the 'ort' strategy.
 lint-ratchet.baseline.json                   | 4 ----
 packages/server/src/services/level-up/asi.ts | 2 +-
 2 files changed, 1 insertion(+), 5 deletions(-)
```

Hook advisory output in both orders was verbatim: **no output**. The merge
process retained the prompt for roughly another 18–22 seconds after the normal
merge summary, consistent with the documented marker-triggered full check, but
the successful truth-up redirects its output and removes the marker. From the
contributor's terminal alone there is no positive evidence distinguishing
"full truth-up ran and passed" from "the marker path did not engage." A manual
post-merge check printed:

```text
$ bun scripts/lint-ratchet.ts --check-baseline
lint:ratchet:check-baseline OK — 434 current finding(s).
```

The following inspection returned `false` for both paths in both orders, and
the order-result comparison returned zero:

```text
false
false
order-baselines-byte-identical=0
```

The live commit gates also remained active. Representative successful output
captured verbatim:

```text
pre-commit: waited 75s for shared commit queue /tmp/musi-commit-queue.lock.bb6d138355bc7a8ccba81f1f3ee52afac39d316ff967e3c61d3bb27d2f1837fa
verify steps: fast-commit mode — skipping test slot (remove the musi-fast-commit marker in the Git common dir to disable)
verify steps: fast-commit mode — skipping scripts slot (remove the musi-fast-commit marker in the Git common dir to disable)
Commit succeeded: fade177e fix(field-exercise): drain level-up boolean finding | 2 files changed, 22 insertions(+), 26 deletions(-)
(fast-commit: test+scripts slots skipped; land via bash scripts/land.sh)
```

Other successful source commits waited 306 seconds and 315 seconds before the
same skip notices. The wait is a shared commit-queue concern, not merge-driver
correctness, but it materially affected the contributor experience.

### Verdict

**Rough edge, correctness PASS.** The headline semantic claim is confirmed in
both orders: both drains survive, both merged baselines are identical, and the
truthful total is 434. The rough edge is observability: a successful truth-up
looks like an unexplained post-summary pause followed by silence.

This is positive field evidence for keeping the per-rule-sharding reopen gate
closed. The driver handles precisely the same-rule/different-files class that
sharding would not solve.

## Scenario 2 — max-lines disjoint additions

### Setup

Two fresh branches each made one deliberately manufactured scratch-only
configuration addition to
`eslint-config/max-lines-exceptions.baseline.json`:

- A: `packages/shared/src/schemas/srd.ts`, cap 320.
- B: `scripts/drift-ai/hotspots-history.ts`, cap 320.

Both entries used `severity: "warn"`, lifecycle `candidate-for-split`, and
`ratchetExcluded: true`. These additions test ledger merge semantics; they are
not a claim that either file needs a production exception. On each branch I
first inserted the entry with the stale base summary, then ran the documented
normalizer. Both branches printed verbatim:

```text
$ bun scripts/max-lines-exceptions.ts --update
max-lines-exceptions -- normalized 26 exception(s)
$ bun scripts/max-lines-exceptions.ts
OK: max-lines exceptions baseline is normalized and valid
```

### Exact Git operations

```sh
git switch -c scratch/mfx2-x-max-a scratch/mfx2-x-base
# add packages/shared/src/schemas/srd.ts entry
bun run lint:max-lines-exceptions:update
bun run lint:max-lines-exceptions
git add eslint-config/max-lines-exceptions.baseline.json
git commit -m 'chore(field-exercise): add shared max-lines exception' -m 'Create one normalized side of the disjoint-addition semantic merge-driver exercise.'

git switch -c scratch/mfx2-x-max-b scratch/mfx2-x-base
# add scripts/drift-ai/hotspots-history.ts entry
bun run lint:max-lines-exceptions:update
bun run lint:max-lines-exceptions
git add eslint-config/max-lines-exceptions.baseline.json
git commit -m 'chore(field-exercise): add script max-lines exception' -m 'Create the other normalized side of the disjoint-addition semantic merge-driver exercise.'

git switch scratch/mfx2-x-max-a
git merge --no-ff scratch/mfx2-x-max-b \
  -m 'chore(field-exercise): merge disjoint max-lines additions' \
  -m 'Exercise base-aware max-lines addition semantics and preserve both normalized entries.'
```

The side commits were `34c09d7e` and `f4e07831`; the merge commit was
`a48f33cc`.

### What Git, the driver, and hooks did

The max-lines semantic driver treated each missing-from-base entry as a
one-sided addition, kept both, sorted them, and regenerated the summary from 26
to 27. Merge stdout was verbatim:

```text
Auto-merging eslint-config/max-lines-exceptions.baseline.json
Merge made by the 'ort' strategy.
 eslint-config/max-lines-exceptions.baseline.json | 10 +++++++++-
 1 file changed, 9 insertions(+), 1 deletion(-)
```

Hook advisory output was verbatim: **no output**. That matches the documented
behavior: disjoint base-aware additions do not take a lower conflicting cap or
collide with a retirement, so they do not require a max-lines truth-up marker.
The merge completed in under a second.

Post-merge structural inspection showed summary count 27 and both complete
entries. Diffs against each parent showed exactly the other parent's one entry
plus the 26-to-27 summary update. The committed checker printed verbatim:

```text
$ bun scripts/max-lines-exceptions.ts
OK: max-lines exceptions baseline is normalized and valid
```

The successful A-side gate included this exact queue/gate output:

```text
pre-commit: waited 214s for shared commit queue /tmp/musi-commit-queue.lock.bb6d138355bc7a8ccba81f1f3ee52afac39d316ff967e3c61d3bb27d2f1837fa
verify steps: fast-commit mode — skipping test slot (remove the musi-fast-commit marker in the Git common dir to disable)
verify steps: fast-commit mode — skipping scripts slot (remove the musi-fast-commit marker in the Git common dir to disable)
Commit succeeded: 34c09d7e chore(field-exercise): add shared max-lines exception | 1 file changed, 9 insertions(+), 1 deletion(-)
(fast-commit: test+scripts slots skipped; land via bash scripts/land.sh)
```

### Verdict

**Clean PASS.** Content, summary, ordering, gate result, lack of unnecessary
truth-up, and contributor-visible merge output all matched the guide.

## Session 2 findings and proposed fixes

### P0

None.

### P1

None. Neither driver lost data, created invalid JSON, or accepted an untruthful
baseline in these scenarios.

### P2 — session 1 F2 remains reproducible: unrelated fingerprint churn

Every honest one-finding lint-ratchet update rewrote all 21
`ratchet/react-hooks-set-state-in-effect-client` message fingerprints. The
behavior is stable in this worktree but unrelated to either source fix, making
each side's generated diff 46 changed lines rather than the expected small
path deletion. This is the same open F2, not a new merge-algorithm defect.

Proposed fix: identify and pin the environment/version input causing the
message drift; then make `--update` explicitly summarize fingerprint-only
refreshes. If cross-environment message text cannot be made stable, consider a
separate opt-in fingerprint refresh so an ordinary drain does not silently
carry unrelated churn.

### P3 — successful lint-ratchet truth-up is invisible

Both same-rule merges printed the ordinary merge summary, then paused for
roughly 18–22 seconds with no start or success line. The docs explain the
marker/full-check machinery, but the terminal does not confirm that it ran.
That makes the fixed F1 path hard to field-audit and looks like a hung hook to
a contributor meeting it cold.

Proposed fix: when a valid marker triggers the expensive full check, print one
short start line and one success line (for example,
`post-merge: lint-ratchet truth-up OK — 434 current finding(s)`). Keep the
existing loud repair advisory for failures.

### P3 — commit queue is silent until after long waits

Commit attempts in this lane reported completed waits of 70, 75, 214, 306,
315 seconds, but the hook printed nothing while waiting; the first progress
line appeared only after it acquired the queue. This is not a merge-driver
defect, but it dominated the contributor experience and encouraged accidental
commit retries (which the separate lock diagnostic correctly warns against).

Proposed fix: print `pre-commit: waiting for shared commit queue ...` before
blocking, then a low-frequency elapsed update (for example every 30 or 60
seconds). Preserve the useful final `waited Ns` line.

## Candid GPT-family UX opinion

The semantic results are excellent. In the max-lines case, the machinery felt
like the ideal generated-ledger merge: normal Git output, instant completion,
and correct normalized content. The same-rule lint merge was also correct and
symmetric, which is the hard part.

Meeting it cold, however, I would not have understood the lint merge's silent
post-summary delay. Without the guide I would have assumed either that Git's
ordinary textual merge happened or that a hook was hung; I would not know a
strict-min truth-up marker was supposed to trigger a full check, and I might
have accepted the merge without manually proving 434 findings. If a fallback
had occurred, I also would have been tempted to hand-edit the generated JSON
before learning the regeneration recipe.

For max-lines, without the docs I likely would have manually adjusted the
summary along with the entry or forgotten to normalize at all. The documented
command was discoverable and its output was self-explanatory. The fast-commit
skip notices were also clear about exactly what was and was not checked. The
shared queue was the least friendly part: several minutes of no output reads as
failure even when everything is healthy.

Bottom line: I trust the driver content after this exercise. I do not yet trust
the terminal UX to teach a first-time contributor what the lint truth-up hook
is doing without the guide open beside them.

## Cleanup list

Branches created by this lane and intentionally left in place (destructive
branch deletion is blocked):

- `scratch/mfx2-x-same-o1-combat` — source side at `2cc5ea92`.
- `scratch/mfx2-x-same-o1-level` — order-1 merge at `3df6a2df`.
- `scratch/mfx2-x-same-o2-combat` — order-2 merge at `361450d0`.
- `scratch/mfx2-x-same-o2-level` — source side at `76693491`.
- `scratch/mfx2-x-max-a` — max-lines merge at `a48f33cc`; also carries this
  session-2 answer commit after reporting.
- `scratch/mfx2-x-max-b` — source side at `f4e07831`.

`scratch/mfx2-x-base` was provisioned before the exercise and was not created
by this lane. No branch was pushed, rebased, amended, force-updated, or merged
into `main` or `fix/post-merge-truthup-marker-gate`.
