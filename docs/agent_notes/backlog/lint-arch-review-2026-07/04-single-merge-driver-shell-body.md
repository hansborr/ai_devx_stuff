# 04 — One shell driver body for the four merge drivers

Status: Done — 2026-07-16: on `auto/lint-arch-drivers`, the four merge-driver
shell bodies collapsed into one keyed body (near-duplicates divergence ruled
copy-drift and unified up), the `.git/info/attributes` rewriting moved from awk
to TypeScript, and the four post-merge truth-up scripts collapsed into one keyed
shared body (option a — sourced in-process so the bun-invocation-log test stubs
still hold). The full TS truth-up state machine (option b, which needs a
truth-up test-harness rework to stub the inner check subprocess) is recorded
below as an explicit follow-up.
Priority: P1 · Size: M · Risk: low (mechanical; pattern already proven in-repo)
Source: lint architecture review 2026-07-16 (R4) — unanimous P1 across all
five reviewers. Thin install/check shims vs. duplicated driver bodies was
spot-verified against source during synthesis.

## Problem

Install/check wrappers are already shared-body-plus-thin-shim, but the four
merge-driver shell bodies (57–98 lines each: identical arg guard, path
resolution, truth-up marker, bun dispatch, fallback recipe) and the four
post-merge truth-up scripts never got the same treatment.

The predicted copy-drift has already happened (verified at HEAD
2026-07-16): three of the four driver bodies are near-identical templates,
but `near-duplicates-baseline-merge-driver.sh` (57 lines) silently
diverged — it drops the missing-current-file guard and the fallback status
messages the other three carry.

## Do

1. Introduce one declarative driver descriptor per baseline: baseline path,
   git driver name, merge CLI, truth-up policy, recovery text. Before
   deduplicating, adjudicate the near-duplicates divergence — decide
   whether the missing guard/status messages were intentional trimming or
   drift, rather than mechanically unifying on either variant.
2. Feed it into one generic shell shim, one installer/checker, and one TS
   truth-up state machine with per-driver callbacks (GPT's preference over
   Grok's accept-as-sunk-cost; synthesis sided with GPT because the repo
   already knows the shared-body pattern, so marginal cost is low).
3. Move the awk-based `.git/info/attributes` block-rewriting into TypeScript
   (Gemini).

Keep the shell/TS split itself — git must invoke a dependency-free
entrypoint, and semantics belong in TS so installed copies can't freeze
behavior. The duplication *within* the shell layer is the problem, not the
boundary.

## Payoff

~300–400 LOC cut; the merge runbook (`docs/guides/lint-ratchet-merges.md`)
loses most of its "four of everything" surface.

## Prior work

`merge-driver-field-exercise.md` (Done 2026-07-16) adversarially validated
driver behavior — its findings file records per-conflict-class verdicts the
descriptor's recovery text should preserve.

## Progress — 2026-07-16 (lane `auto/lint-arch-drivers`)

**Landed (2 commits):**

1. `refactor(git): collapse four merge-driver bodies into one keyed body`
   (97483bbe). The four `*-baseline-merge-driver.sh` bodies became one generic
   `scripts/git/baseline-merge-driver.sh` selected by a driver key baked into
   `merge.<name>.driver` ahead of Git's `%O %A %B %L %P`; every baseline installs
   the one generic body (`musi/baseline-merge-driver.sh`). The thin-shell /
   TS-semantics split is preserved: the body still dispatches to each baseline's
   existing bun merge CLI and only prints the per-driver recovery recipe on
   fallback. Each recipe (including lint-ratchet's field-exercise recovery text)
   is preserved verbatim in the per-driver descriptor.
2. `refactor(git): move attributes block-rewriting from awk to TypeScript`
   (8b1f3adc). The `.git/info/attributes` managed-block rewriting moved from awk
   in `baseline-merge-driver-lib.sh` to `scripts/git/baseline-info-attributes.ts`
   with a unit test; the render helper is now a thin bun dispatch. Output is
   byte-compatible (install/check converge).

**Near-duplicates divergence adjudication — ruling: copy-drift, unify up.**
`near-duplicates-baseline-merge-driver.sh` was added 2026-07-15 (`ffb3f3c2`),
last of the four and well after the template (lint-ratchet 2026-06-05, knip +
max-lines 2026-07-09). Its introducing commit was a bulk feature promotion with
no note of an intentional trim, and it dispatches to the same shared
`runMergeDriverCli` every driver uses, so there is no semantic reason it needed
less guarding. The dropped missing-current-file guard and the two fallback
status messages were drift, not deliberate trimming: the unified body restores
the fuller behavior for every driver. Each driver's recovery-recipe *text*
remains genuinely per-driver and is preserved verbatim.

3. `refactor(git): share one keyed truth-up body across the four drivers`
   (9ed13923). The four `*-post-merge-baseline-truth-up.sh` skeletons (context
   validation, repo/git-dir/marker resolution, diff-base selection, marker-stamp
   check, baseline-diff gate) collapsed into one keyed
   `scripts/git/baseline-post-merge-truth-up.sh` body with four thin shims —
   option (a) below. The shared body is SOURCED in-process (not re-dispatched
   through bun), so the driver's own check command stays the only subprocess and
   the existing bun-invocation-log test stubs still hold. Per-driver policy stays
   in the keyed handlers (lint-ratchet preflight escalation; knip
   FAIL/summary-drift/corrupt branches; near-duplicates marker-only trigger +
   marker-head squash guard + env-vs-stale classification; max-lines marker-only
   advisory that always consumes); advisory/recovery text preserved verbatim.

**Follow-up: the full TS truth-up state machine (Do item 2 as literally
written).** Option (a) — the shared *shell* body above — was landed because it
removes the duplication while staying test-compatible. Moving the orchestration
into a bun-run TS state machine (option b) collides with the existing test
architecture: `assert_lint_ratchet_post_merge_truth_up`, the knip/max-lines
equivalents, and the near-duplicates dispatch smoke stub `bun` at the
*check-command* granularity (recognizing exactly
`run …post-merge-baseline-preflight.ts` / `run lint:ratchet:check-baseline`
etc.) and assert on a bun-invocation log. A `bun run baseline-truth-up.ts`
orchestrator would make every stub error with "unexpected bun invocation" and
invert the "bun was not called" assertions. Doing option (b) therefore requires
a deliberate rework of the truth-up test harness so it stubs the inner check
subprocess rather than top-level `bun` — worthwhile if/when the truth-up
classification is wanted in TypeScript, but out of scope here.
