# 128. Baseline-family metadata (label, baseline path, CLI path, install command) is repeated per key across five hand-maintained surfaces with nothing checking they agree

Status: Landed on fix/cq-128
Theme: cross-surface metadata parity · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The four generated-baseline families (`lint-ratchet`, `knip-unused-exports`,
`near-duplicates`, `max-lines-exceptions`) each carry a small metadata tuple —
display label, committed baseline path, semantic merge-CLI path, install
command, git driver name, info-attribute lines — and that tuple is spelled out
by hand, per key, in about five different places: the merge driver's descriptor
`case`, the post-merge truth-up's metadata `case`, the TypeScript merge-CLI
table, the conflict-recipe doc generator's key→baseline-path map, and each
family's `*-merge-driver-lib.sh` plus install/check/truth-up shims. The labels
and baseline paths are verbatim-duplicated across these files.

`scripts/git/baseline-drivers.sh` genuinely single-sources the family *names*
for the three dispatch loops, and its header says "adding a fifth baseline
artifact is now a one-line change here" — but that is true only of the
dispatchers. Actually adding or renaming a family also requires synchronized
edits to every surface above, and no check, test, or document enumerates them.
A contributor who misses one gets a silent partial family: a driver that
dispatches but truth-up ignores, a CLI table entry whose label disagrees with
the driver's messages, or a doc generator that projects no recipe. Completeness
review today rests on a maintainer remembering the list — repository folklore.

Centralizing the metadata at runtime is not an available fix: the installed
driver copy must stay standalone pure bash, the truth-up body is sourced
in-process by hooks under a deliberately minimal PATH, and the CLI table is
deliberately import-free at runtime. A prior-pack ruling also forbids further
parameterization of this script family. What is missing is not a registry —
it is an enforced agreement check.

## Evidence

- `scripts/git/baseline-drivers.sh:22-27` — `MUSI_BASELINE_DRIVERS`, the
  four-key authoritative name list; header (`:12-16`) names only the three
  dispatch consumers and claims a new family "is now a one-line change here".
- `scripts/git/baseline-merge-driver.sh:29-55` — descriptor `case` assigning
  `driver_label` / `semantic_driver` / `install_hint` per key; per-family
  conflict-recipe heredocs follow at `:113-213`.
- `scripts/git/baseline-post-merge-truth-up.sh:24-45` — second metadata `case`
  assigning `_tu_label` / `_tu_baseline_file` per key.
- `scripts/baseline-merge-cli-table.ts:22-39` — `BASELINE_MERGE_CLI_TABLE`,
  third copy of the same tuples as `displayLabel` / `cliPath`; its `cliPath`
  values duplicate the driver arm's `semantic_driver` strings verbatim.
- `scripts/generate-baseline-conflict-recipes.ts:23-28` —
  `BASELINE_PATH_BY_DRIVER_KEY`, fourth copy (key → committed baseline path,
  duplicating `_tu_baseline_file`); currently module-private (no `export`).
- Per-family shell constants, fifth copy: `MERGE_DRIVER_METRIC_LABEL` /
  `MERGE_DRIVER_INSTALL_COMMAND` in each install/check shim (e.g.
  `scripts/git/install-lint-ratchet-merge-driver.sh:9,12`), the lib's
  info-attributes `merge=` line naming the baseline file again (e.g.
  `scripts/git/lint-ratchet-merge-driver-lib.sh:21-23`), and the truth-up shims
  setting `MUSI_TRUTH_UP_KEY` (e.g.
  `scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh:9`). All 16
  conventional per-family files exist today (`install-*`, `check-*`, `*-lib`,
  `*-post-merge-baseline-truth-up` for each of the four keys).
- Concrete verbatim spread: the label `max-lines exceptions` appears in
  `baseline-merge-driver.sh:46`, `baseline-post-merge-truth-up.sh:38`,
  `baseline-merge-cli-table.ts:28`, and
  `install-max-lines-exceptions-merge-driver.sh:9`; the path
  `eslint-config/max-lines-exceptions.baseline.json` in
  `baseline-post-merge-truth-up.sh:39` and
  `generate-baseline-conflict-recipes.ts:27`.
- Runtime-centralization is contractually blocked:
  `scripts/git/baseline-merge-driver.sh:4-9` (installed copy is standalone,
  "pure bash, no sourcing of sibling scripts, all per-driver data embedded"),
  `scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh:10-12` (truth-up
  hooks run under "a deliberately minimal PATH"), and
  `scripts/baseline-merge-cli-table.ts:8-10` ("this table is deliberately
  import-free at runtime" for the sandboxed merge smoke).
- Prior decisions on record: standing ruling at
  `docs/agent_notes/backlog/code-quality-2026-07-25/CONSTRAINTS.md:18` — do not
  parameterize the baseline merge-driver family further — and
  `scripts/baseline-merge-cli-table.ts:10-12`, which records the explicit
  rejection of a broader cross-CLI unification.

## Proposed direction

Do **not** build a baseline-family metadata manifest/generator, and do not
generate anything into the `scripts/git` bash surfaces. The agreed shape is a
verify-time cross-surface parity gate over the intentionally hand-written
surfaces — the repo already teaches declare-once+generate several times over;
a parity gate over hand-written surfaces is the pattern it does not yet show.

1. Add one scripts-Vitest file, e.g. `scripts/baseline-family-parity.test.ts`.
   It is auto-discovered (`scripts/vitest.config.ts:12` includes
   `**/*.test.ts`) — no registration surfaces. Treat `MUSI_BASELINE_DRIVERS`
   in `scripts/git/baseline-drivers.sh` as the authoritative key set and
   assert, per key:
   - the descriptor case arm in `scripts/git/baseline-merge-driver.sh` yields
     `driver_label` / `semantic_driver` / `install_hint`;
   - the metadata case in `scripts/git/baseline-post-merge-truth-up.sh` yields
     `_tu_label` / `_tu_baseline_file`, and a dispatched handler shim exists;
   - `BASELINE_MERGE_CLI_TABLE` (direct import from
     `scripts/baseline-merge-cli-table.ts`) agrees on `displayLabel` /
     `cliPath` with the driver arm;
   - `BASELINE_PATH_BY_DRIVER_KEY` in
     `scripts/generate-baseline-conflict-recipes.ts` agrees with
     `_tu_baseline_file` (add the one-keyword `export` to the const);
   - the conventional per-family files exist (`<key>-merge-driver-lib.sh`,
     `install-<key>-merge-driver.sh`, `check-<key>-merge-driver.sh`,
     `<key>-post-merge-baseline-truth-up.sh`); the lib's info-attributes
     `merge=` line names the same baseline file; the shims'
     `MERGE_DRIVER_METRIC_LABEL` / `MERGE_DRIVER_INSTALL_COMMAND` match the
     driver arm; and every referenced `bun run` script name exists in the
     relevant `package.json` (all four `install_hint` scripts exist at the
     root today: `package.json:79,99,141,145`).
2. Elect one authority per field, explicitly documented in the test header:
   keys from `baseline-drivers.sh`; label and CLI path from the driver arm;
   baseline path from truth-up. This answers the schema-lives-in-the-checker
   concern without introducing a JSON manifest.
3. Make failure messages name the missing or disagreeing surface per key, so
   the test's output *is* the add-a-family checklist.
4. Extend the `baseline-drivers.sh` header comment with the enumerated surface
   checklist, pointing at the parity test as the completeness oracle (and
   retire the "one-line change" overclaim while there).

Mechanics: reuse the case-arm extraction style already landed in
`scripts/generate-baseline-conflict-recipes.ts` (`collectArmLines` at `:47`,
`extractDriverRecipe` at `:101`); fail loud on parse misses rather than
skipping a key. Run with `bun run test:scripts:file -- scripts/baseline-family-parity.test.ts`.

Restated by review: with four stable entries the severity is low-medium and
the size is S (down from M). Clean upgrade path: if the family ever starts
growing fast, the test's extractors become a generator's `--check` verbatim.

## Scope / caveats

Binding rulings for this leaf:

- **No manifest/generator.** Do not build a baseline-family metadata
  manifest or generate any projection into the `scripts/git` baseline bash
  surfaces — this upholds the standing prior-pack ruling
  (`code-quality-2026-07-25/CONSTRAINTS.md:18`, "do not parameterize the
  baseline merge-driver family") and the recorded rejection in
  `scripts/baseline-merge-cli-table.ts:10-12`. Coherence is enforced by the
  one parity test only.
- **Never make `baseline-merge-driver.sh` a splice/generation target.** It is
  already the parse *source* for `generate-baseline-conflict-recipes.ts`;
  splicing generated arms into it would give one hook-critical file three
  roles (authored, spliced, parsed). Keep it hand-authored and single-role.
- **No runtime querying of any shared registry** from the installed driver
  copy, the truth-up bodies, or the merge-CLI table — standalone pure-bash,
  minimal-PATH, and import-free-at-runtime contracts respectively. Parity is
  a verify-time property only.
- **Conflict-recipe prose and per-key truth-up handlers stay out.** The
  recipes are already single-sourced in `baseline-merge-driver.sh` and
  doc-projected with drift `--check`; the truth-up handlers are genuinely
  divergent behavior. The parity test touches them only as existence/dispatch
  checks.

Other caveats:

- **Implemented live-tree narrowing:** the uniform five-surface model now
  applies only to the three Musi-owned families (`knip-unused-exports`,
  `near-duplicates`, and `max-lines-exceptions`). `lint-ratchet` migrated into
  the versioned `@musi/lint-ratchet` package and is classified explicitly as
  `package-owned` in `scripts/baseline-family-parity.test.ts`; the test still
  derives all four dispatched keys from `MUSI_BASELINE_DRIVERS`, so a fifth key
  cannot land without a deliberate policy classification.
- For the three `uniform` keys, the parity test enforces the full tuple and
  conventional-file checks proposed above. For `lint-ratchet`, it instead pins
  the stale-registration tombstone and its valid root install script, the three
  retained shims, dispatch-registry membership, and the baseline-path map.
  It also pins the deliberate absence of a shared truth-up metadata arm,
  repository merge-driver lib, merge-CLI table row, descriptor assignments,
  and repository-owned shim constants, so a partial reversal of the package
  migration fails as loudly as an incomplete new family.
- The new scripts-Vitest file remains auto-discovered and needs no smoke-subject
  or fixture-copy registration. The normal lint-coverage inventory gate did
  require adding it to the existing baseline merge-CLI coverage row and
  refreshing `docs/generated/lint-coverage-map.md`; that generated inventory
  update does not change verify selection.
- The only production-code edit this leaf sanctions is the `export` keyword on
  `BASELINE_PATH_BY_DRIVER_KEY` plus comment updates (`baseline-drivers.sh`
  header; optionally a pointer from the other surfaces to the parity test).
  Behavior of every merge/truth-up path is unchanged.
- The prior-pack overlap is the standing CQ25-83 ruling, not a landed leaf:
  it rules on parameterizing the driver *dispatch* family (already done via
  the shared lib + ~15-line shims) and does not cover this residual metadata
  duplication — but its spirit is why the fix here is a gate, not a registry.
- Leaf [129-post-merge-truth-up-parses-human-diagnostics.md](./129-post-merge-truth-up-parses-human-diagnostics.md)
  has landed on `fix/cq-224`, so its former concurrent-edit caveat is moot.
  The substantive independence remains: this parity test reads only the first
  `case "$_MUSI_TRUTH_UP_KEY" in` metadata block, which leaf 129 did not move.
- If a later change renames the anchor patterns the test parses
  (`print_conflict_recovery`, the `case` labels, `_tu_label=` /
  `_tu_baseline_file=` assignments), the fail-loud extraction turns that into
  a test failure naming the surface — that is the intended tripwire, not
  collateral flake; update the extractor alongside the rename.
