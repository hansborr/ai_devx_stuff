# 28-PLAN. scripts/ layout contract: scheduling plan and parked-note reconciliation

Status: Planned — supersedes the Proposed direction in
[`28-scripts-layout-families.md`](./28-scripts-layout-families.md) **and** the
parked note [`scripts-flat-family-reorg.md`](../scripts-flat-family-reorg.md)

Date: 2026-07-26 · Area: harness · Source leaf: 28 (XL)

Cross-model planning session: `consult codex` (four internal angles, synthesized)
and `consult cursor` (Grok, outside view). Disagreements and calls are recorded
in [Rejected alternatives](#rejected-alternatives--why).

## Reconciliation verdict (definitive)

**This plan supersedes `docs/agent_notes/backlog/scripts-flat-family-reorg.md`.
That note is absorbed and closed; it does not become the owner.**

This reverses what leaf 28 step 1 proposes ("fold this leaf's family half into
the parked note") and what the cursor consult recommended ("reopen the parked
note as the single owner"). The codex consult independently reached the same
verdict as this plan. Reasons:

- The parked note is dated 2026-07-03 and its inventory is stale in every entry:
  it records `lint-coverage-map-check*` at 9 files (live: 13),
  `client-test-isolation*` at 6 (live: 6), `sensor-knip-unused-exports*` at 4
  (live: 6). It names three families; there are seven, plus `worktree-seed`.
- Folding fresher, evidence-backed findings into a Parked note re-parks them and
  moves the work outside the scheduled pack that the index tracks.
- Both directions achieve "one live owner". Only this one keeps the owner
  current and schedulable.

**Absorbed from the parked note** (nothing is lost):

- The `drift-triage*` precedent — that family collapsed into
  `scripts/drift-triage/` behind a flat `scripts/drift-triage.ts` entry on
  2026-07-18. That entry-plus-directory idiom is the shape every family move in
  this plan reuses; do not invent a new one.
- The `scripts/harness-audit/` hollow-directory concern, folded in from
  arch-review-2026-07 Tier 3.
- Its framing that the deliverable is *choosing and documenting one position*,
  which is why slice 28.1 comes before any file move.

Slice 28.1 marks the parked note `Status: Superseded` with a pointer here. A
pointer line has been added to it already so it cannot be picked up in isolation
before then.

## Reconciled scope decision

The finding is real and verified live at `c69ce720`: `scripts/README.md:42`
states a hard rule ("Do not add a new implementation family as
`scripts/<topic>-*.ts`") that nothing reads back, and the tree has outvoted it —
162 top-level files, with flat families at `lint-coverage-map` 13,
`backlog-lint` 12, `suppression-ledger` 10, `sensor-near-duplicates` 9,
`worktree-seed` 7, `client-test-isolation` 6, `max-lines` 6,
`sensor-knip-unused-exports` 6. `suppression-ledger` landed on 2026-07-25 with
nothing in the tree to flag it.

**Enforcement is kept. The proposed mechanism is replaced.** Leaf 28 step 2
proposes deriving each file's role by reading `package.json` script bodies,
`.husky/` hooks, `.github/workflows/`, and `scripts/doctor.sh`. Both consults
rejected this independently: the README's roles are semantic
(`scripts/README.md:11-30`), and invocation relationships are not reliably
recoverable from shell and YAML text. A parser that is wrong fails builds for
reasons reviewers cannot read.

Replace it with a **closed-world declarative inventory**: every direct child of
`scripts/` appears exactly once with a category —

- `command` or `hook-surface`
- `facade`, with an existing owner directory
- `companion`, naming its owning entrypoint
- `exception`, with a reason
- `legacy-family`, with an explicit move-or-defer disposition

The checker validates exact coverage, uniqueness, path existence, owner
existence and facade-directory existence, and may cross-check `package.json`
command paths because that file is structured JSON. It infers nothing from shell
or YAML bodies.

This is not new machinery for this repo — it is the established idiom.
`scripts/harness/manifest-contract-check.ts:1-31` is the direct precedent: a
categorised, shrink-only allowlist that explicitly "guards cooperative agents
against the accidental new bypass, not adversaries". `scripts/lib/doc-generator.ts`
already provides the check-mode/freshness harness used by 17 consumers and five
generated docs. Building the inventory on those costs roughly one session, not
the epic the leaf implies.

The guarantee is the one that matters: **an undeclared top-level file cannot
land.** Neither this design nor the leaf's parser can decide the subjective
question "have these companions become a family" without a misleading threshold.
That stays a reviewer judgement — but the inventory makes it *visible*, which is
what was missing when `suppression-ledger` landed.

### Also dropped or changed from the leaf

- **`scripts/harness/` `harness-` de-prefix rename (step 5) — dropped.** Both
  consults called it central-path import churn with negligible cold-navigation
  benefit. Record the two spellings in the README instead.
- **`scripts/harness-audit/` (step 4) — resolved by a third option the leaf did
  not consider.** The leaf poses a binary: move the fixtures out (expensive) or
  document the split (cheap but leaves the defect). Instead **move
  `scripts/harness-audit.ts`'s report module and `scripts/harness/harness-audit.test.ts`
  *into* `scripts/harness-audit/`**, keeping `scripts/harness-audit.ts` as the
  facade. Verified: the exclusion glob is `scripts/harness-audit/fixtures/**` in
  both `eslint-config/shared-policy.js:74` and `tsconfig.scripts.json:20`, so the
  fixture path never moves and **no config surface is touched**. This ends the
  three-home split at the cost the leaf assigned to merely documenting it.
- **`worktree-seed` — ruled on here, moved by leaf 29.** Its consumer is
  `scripts/worktree-db.sh`, and leaf 29 step 4 proposes a `scripts/worktree-db/`
  owner directory. Moving it in this leaf pays the generated-fixture blast twice.
  Slice 28.1 records the disposition; leaf 29 executes it.
- **New, in neither the leaf nor the parked note:** `scripts/README.md`'s Current
  Directories table omits three owner directories that exist —
  `scripts/data/`, `scripts/lint-message-eval/`, and `scripts/test-support/`.
  The last is load-bearing for leaf 27's plan (it holds
  `tmp-repo.test-helper.ts`, used by ~22 TS tests). The table is already stale;
  slice 28.1 fixes it.
- **`scripts/drift-ai/` — unchanged from the leaf.** Do not restructure 344 flat
  files; add the `MODULE.md`. Both consults agreed.

## Slices

Each slice is one agent session and lands on its own. Flags: **[G]** changes
generated harness/subject/doc output; **[C]** touches a config surface and so
triggers a full-scan lint.

| # | Slice | Done when | Verify |
|---|---|---|---|
| 28.1 | **The written position.** Mark the parked note `Status: Superseded` with a pointer here. Record a move/exception/defer ruling for each of the seven flat families, re-derived from the live tree; rule `worktree-seed` as deferred to leaf 29 and `adr-check`/`sensor-blob-size`/`sensor-context-budget` as sanctioned companions. Add the missing `data/`, `lint-message-eval/`, `test-support/` rows to the README directory table, and a line recording the two `scripts/harness/` spellings. No code. | One decision record; README matches the tree; parked note closed | `bun run backlog:lint`; `bun run format:check` |
| 28.2 | Add `scripts/drift-ai/MODULE.md` per `docs/guides/add-module-doc.md`, modelled on `scripts/drift-triage/MODULE.md`. Name the prefix families (`duplicate`, `hotspots`, `coldspots`, `knip`, `coverage`, `semgrep`, `ghost`, `env`, `dolos`, `test-orphaning`, `ownership`, `near`, `clone`, `birth-size-delta`, `class-construction`) **as names, never as file counts** — counts are stale on arrival. Promote the two-registry layering law from `check-metadata.ts:1-6` into prose and leave the comment verbatim in place. | MODULE.md exists and states the layering law | `bun run module:index`; `bun run module:index:check` |
| 28.3 | **harness-audit consolidation.** Move the report module and `scripts/harness/harness-audit.test.ts` into `scripts/harness-audit/`; keep `scripts/harness-audit.ts` as the facade; leave `fixtures/` exactly where it is. Do not touch `eslint-config/shared-policy.js` or `tsconfig.scripts.json`. | One tool, one directory, facade intact, zero config-surface diff | `bun run test:scripts:file -- scripts/harness-audit/harness-audit.test.ts`; `bun run harness:check` |
| 28.4 **[G]** | **The layout inventory and validator.** Add the declarative inventory plus a checker validating exact coverage, uniqueness, and owner/facade existence, with tests. Seed it from the current tree so the debt is enumerated rather than invisible. Wire into **full `harness:check` only** — see risk 1. Expect `harness.controls.json` and verify-fragment regeneration in the same slice. | A new undeclared top-level file fails `harness:check`; seeded list covers all 162 | focused validator test via `bun run test:scripts:file -- <test>`; `bun run verify:steps`; `bun run verify:steps:check`; `bun run harness:check` |
| 28.5 | Move `client-test-isolation` internals and tests under an owner directory; retain the runner and any genuinely public facade. Flip its inventory rows from `legacy-family` to facade/owner. | Public top-level paths stable; old-path sweep empty | moved Vitest tests; `bash scripts/tests/test-test-client.sh`; `bun run harness:check` |
| 28.6 | Same for `backlog-lint`; retain `scripts/backlog-lint.ts`. | as above | moved tests; `bun run backlog:lint`; `bun run harness:check` |
| 28.7 | Same for `suppression-ledger`; retain `scripts/suppression-ledger.ts`. Gate-command family — the entrypoint is wired to `lint:suppressions:ledger`. | as above | moved tests; `bun run lint:suppressions:ledger`; `bun run harness:check` |
| 28.8 | Same for `sensor-knip-unused-exports`; retain the sensor and merge-CLI facades. Two `sensor-*` families get **two** owner directories — a single `scripts/sensor/` would repeat the first-segment grouping error this plan rejects. | as above | moved tests; `bun run sensor:knip-unused-exports`; `bash scripts/tests/test-lint-ratchet.sh`; `bun run harness:check` |
| 28.9 | Same for `sensor-near-duplicates`; retain the sensor and merge-CLI facades; preserve pre-push-visible paths. | as above | moved tests; `bun run sensor:near-duplicates`; `bash scripts/tests/test-lint-ratchet.sh`; `bun run harness:check` |
| 28.10 | Same for `max-lines`; retain the command and merge-CLI facades. **Do not edit `eslint-config/`** — if a change there becomes unavoidable, the slice is **[C]**. | as above | moved tests; `bun run lint:max-lines-exceptions`; `bash scripts/tests/test-lint-ratchet.sh`; `bun run harness:check` |
| 28.11 **[G]** | `lint-coverage-map` **last** — the most entangled. Retain both check and generator facades. Update exact `triggerPaths`, fixture paths, shell fixture copies, generated coverage documentation and subjects atomically. | as above, plus generated coverage doc fresh | moved tests; `bash scripts/tests/test-lint-coverage-map-gen.sh`; `bun run docs:lint-coverage-map:check`; `bun run harness:check` |

**Facade preservation is the rule for every move slice** (28.5–28.11): the
package-facing top-level path stays put and only internals and tests move. This
is what keeps these slices out of **[C]** — moving a facade would churn
`package.json`, harness controls and path-policy for no gain, and contradicts
`scripts/README.md:22-30,42-44`.

Done, for every move slice: public top-level paths stable; implementation and
tests under the owner directory; inventory rows flipped from `legacy-family`;
an old-path reference sweep empty except for intentionally historical prose;
generated outputs landed in the same commit.

## Dependency edges

- `28.1 → 28.4` (declare the position before mechanising it).
- `28.1 → 28.5…28.11` (a family only moves once its ruling says "move").
- **`28.1 → leaf 29`, corrected.** The pre-reconciliation dependency list in
  [`00-index.md`](./00-index.md#how-to-use-this-pack) recorded
  `28 steps 1-2 → 29`.
  Step 2 is a full session of machinery; blocking leaf 29 on it is over-blocking,
  since 29 only needs to know *what shape to create*. The hard edge is the
  written position (28.1). 28.4 before 29 is preferred but not blocking — if 29
  lands first, its new `scripts/worktree-db/` directory is simply declared when
  28.4 seeds the inventory. Codex kept the original edge; cursor loosened it to
  "rulings + inventory"; this is the middle call.
- `leaf 29 owns the `worktree-seed` move`, per 28.1's ruling.
- 28.2 and 28.3 are independent of everything and can land at any time — they are
  the cheapest useful work in this leaf.
- 28.5–28.11 are independent of one another; the ordering below is by coupling.

## Operational risk

1. **Wire the inventory check into full `harness:check`, never into
   registration admission.** `.husky/pre-commit:341-344` runs
   `harness:registration:check` under a hard 5-second timeout, before cached
   marker reuse, on every source-relevant commit. Full harness validation
   already runs in CI and in `scripts/land.sh` before landing. Navigability
   policy must not become a universal edit-loop dependency.
2. **Every move slice triggers a full 52-suite smoke run on its own commit.**
   `scripts/path-policy/path-policy.ts:283-287` marks any deleted path under
   `scripts/` smoke-sensitive, and `scripts/test-scripts.sh:196-214` falls back
   to the full suite on an unmapped deletion, holding the shared commit queue
   while it runs. This is expected, not a failure — budget the time and do one
   family per commit so it is paid once per family.
3. **28.4 fails every agent's next new top-level script until they declare it.**
   That is the intended behaviour, but ship it with the seeded list complete and
   a one-line "how to add an entry" comment, and land it *after* 28.1's rulings
   so the categories mean something.
4. **Partial `harness.controls.json` or generated-fragment changes fail
   structural registration for everyone.** Regenerate and commit atomically
   within the slice.
5. **28.11 relocates subject ownership as well as files.** It is last for that
   reason. `docs/generated/lint-coverage-map.md` and the lint-ratchet baseline
   both enumerate its paths.
6. **Config-surface escalation triggers** are `package.json`, root/package
   tsconfigs, `eslint.config.*`, `eslint-config/`, and `eslint-rules/`. Facade
   preservation is what keeps 28.5–28.11 clear of them; 28.3's third option is
   what keeps the harness-audit fix clear of them.

## Rejected alternatives + why

| Rejected | Why |
|---|---|
| Role-derived check parsing `.husky/`, workflows and `doctor.sh` (leaf step 2) | Roles are semantic; shell/YAML invocation topology is not soundly recoverable from text. A false failure here blocks commits for a reason no reviewer can read. Both consults rejected it independently. |
| Filename-prefix count threshold | The leaf is right: it invents a 32-file `lint` family and a `check` family out of unrelated entrypoints, and clears `harness-*`. Cannot express the four README roles. |
| Keep the rule as unenforced prose / delete it from the README | Cursor floated deletion as an honest fallback. Rejected: `suppression-ledger` landed ten flat files on 2026-07-25 with nothing to flag it. One session of brake is cheaper than the next such week. |
| Fold leaf 28's family half into the parked note (leaf step 1, and cursor's verdict) | Re-parks fresh evidence in a note whose every count is stale and which misses four of seven families. Both directions give one owner; only this one gives a current one. |
| Keep both leaf 28 and the parked note live | Exactly the duplicate-ownership drift this pack exists to reduce. |
| Move `scripts/harness-audit/fixtures/` out (leaf step 4, option A) | Touches `eslint-config/shared-policy.js:74` and `tsconfig.scripts.json:20` → full-scan lint, plus baseline and coverage-map churn. |
| Merely document the harness-audit split (leaf step 4, option B; cursor's pick) | Cheap but leaves one tool in three homes. 28.3's third option fixes it at the same cost. |
| Rename every `harness-*` file in `scripts/harness/` (leaf step 5) | Central import and generated-path churn for negligible cold-navigation benefit. Document the two spellings instead. |
| Restructure `scripts/drift-ai/` into subdirectories | The gap is navigation and an undocumented invariant, not layout. Moving 344 files breaks the flat relative-import convention the two registries depend on. |
| Move facades into their owner directories | Needless `package.json`, harness-control and path-policy churn, and contrary to `scripts/README.md:22-30`. |
| Move `worktree-seed` in this leaf | Leaf 29 is decomposing its consumer; moving twice pays the generated-fixture blast twice. |
| A single `scripts/sensor/` directory for both sensor families | `sensor` is a `package.json` command namespace, not a family. Grouping on it repeats the first-segment error this plan rejects. |
| Batch two family moves into one commit | Each move already forces a full smoke run; batching makes the failure ambiguous without saving a run. |

## Consult disagreements and how they were called

- **Parked-note direction.** Cursor said reopen the note as owner; codex said
  supersede it. Called for codex — verified staleness in all three of its
  recorded counts decided it.
- **harness-audit.** Cursor said document (avoid the config blast); codex found
  the third option that moves the logic *in*. Called for codex after verifying
  the exclusion glob is fixtures-scoped — it dominates both of the leaf's
  options.
- **`28 steps 1-2 → 29`.** Codex kept it; cursor loosened it. Split the
  difference: 28.1 hard, 28.4 soft.
- **Enforcement at all.** Cursor offered "delete the rule" as a fallback; codex
  did not. Kept enforcement, on the `suppression-ledger` evidence.
