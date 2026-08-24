# 44. Comments record the change that produced the code instead of stating what the code does, anchoring on bare leaf/task ids, a deleted awk script, and closed follow-ups — and some of those strings render into generated docs

Status: **Landed 2026-07-30 on branch `feat/cq-server-comments-s12-s13`
(merge `3b7830ce4`)** through [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md)
slices **S12 and S13**, cut to roughly a fifth; the plan shrinks this leaf L→S and
**corrects its central evidence in both directions** (see `## Evidence` below
and the plan's correction 1). **Steps 6, 7, 8 and 9 are dropped permanently** —
do not schedule the 60-plus bare-coordinate sweep (one carve-out,
`scripts/lib/eslint-json.ts`, survives in S13), the two header trims, or step
9's failure-reporting restructure, which is not comment work at all.
Theme: comment provenance · Area: comments · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

A large share of the prose in `scripts/`, `tools/`, and `packages/server/` is
written from the point of view of the change that produced it rather than the
reader who arrives later. That produces four recurring shapes, all with the same
failure mode — **the comment names an authority the reader cannot reach**:

1. **Bare backlog coordinates.** `leaf 12`, `leaf 06`, `leaf 61`, `leaf 76`,
   `leaf 23`, `leaf 03g`, `leaf 40 step 3`, `leaf 50 step 2`, `task 39`,
   `ux-audit P0-3`. These are unqualified: no pack directory, no path. A reader
   cannot resolve "leaf 06" without knowing which of the ~dozen backlog packs it
   belongs to. The `task NN` references in `scripts/drift-ai/` cite two packs
   that were deleted from the tree, and the same number means different things
   in each: `docs/agent_notes/backlog/drift-ai-next-items/` (removed in
   `9c860c7f`, 2026-06-20) supplies 15, 30, 38-48 and their letter suffixes,
   while `docs/agent_notes/backlog/drift-ai-tasks/` (removed in `7c560a8d`,
   2026-06-02) supplies the hotspots 40-42 and the `50` opportunistic-cleanup
   rows — `task 40` is the clone-benchmark corpus in the first and the hotspots
   history collector in the second, and `task 30` is the knip-duplicates
   category in the first and the adapter policy in the second.
   `scripts/drift-ai/clone-corpus.ts:6` and
   `scripts/drift-ai/docs/prototype-calibration.md:38,82,112` already qualify
   their refs with the next-items pack name, which is the shape the rest should
   follow. `ux-audit P0-3` is the id that most looks unresolvable: it appears in
   six `packages/server/src` files (plus an e2e spec, a lint baseline, and the
   hand-maintained incident log `docs/generated/observed_flaky_tests.md`), and
   the pack whose name it echoes — `docs/agent_notes/backlog/ux_ui_audit/` —
   contains zero occurrences of the string `P0` anywhere, including under
   `findings/`. It resolves only to a separate top-level document,
   `docs/agent_notes/ux-audit-2026-06-06.md:87`, which a reader following the
   id's own wording will not find.
2. **The generated-doc leak, which is the sharpest edge.** Four of these bare
   coordinates sit inside `principle` strings of
   `scripts/lint-ratchet/lint-ratchet-config.ts`, which
   `scripts/harness/generate-harness-controls.ts` renders verbatim into
   `docs/generated/harness-controls.md`, and which
   `scripts/lint-ratchet/diagnostics.ts:196` also puts in the `why` field of the
   regression envelope an agent reads. The repo's own operator documentation
   therefore instructs a reader to consult "the leaf 06 inventory" and "the
   final Leaf 41g test rows" with no way to find either. Two more sit in
   `zeroBaselineDisposition.reason` strings (`:405`, `:423`) that render nowhere
   today — the generator projects only `principle`, and the zero-baseline
   audit's `nextAction`
   (`tools/lint-ratchet/src/governance/zero-baseline.ts:198`,
   `exitPath ?? reason`) is shadowed by the `exitPath` both rows set (`:406`,
   `:424`). They are the same defect one config edit away from surfacing, so
   step 1 fixes all six.
3. **Anchors to code that no longer exists.**
   `tools/lint-ratchet/src/git-rail/info-attributes.ts` states its contract five
   separate times as "matches the previous awk". The awk implementation was
   removed in commit `8b1f3adc` and is not in the working tree, so the file's
   stated specification is unverifiable by anyone reading the tree today.
4. **Prose that has diverged from what it describes.** The
   `packages/server/src/services/README.md` "Deferred convergence follow-ups"
   section says its items are "intentionally not done", then both bullets are
   marked `(done)` with full historical rationale. `scripts/harness-check.ts`
   also carries a hand-typed list of nine generated surfaces while
   `harness.controls.json` declares eleven; the list is derived at runtime, so
   the prose copy can only rot further.

A smaller, separable cluster is the same instinct pointed inward: a statement
made twice in one file so the copies can disagree
(`scripts/harness/harness-diagnostics-output.ts`,
`packages/server/src/routes/upload-routes.ts`), and one comment that an import
has physically separated from the constant it documents
(`scripts/drift-ai/prototype-advisory.ts`).

The cost is concrete. `scripts/lib/atomic-write.ts:4-7` shows what the fix looks
like: it cites the same kind of decision but spells out the pack path, so the
reader can go read it. Every other site is one keystroke away from that and
does not do it.

## Evidence

### Bare coordinates in lint-ratchet metadata (four of six render today)

- `scripts/lint-ratchet/lint-ratchet-config.ts:157` — `principle: "... beyond
  the leaf 12 inventory ..."` → `docs/generated/harness-controls.md:570`.
- `scripts/lint-ratchet/lint-ratchet-config.ts:402` — `principle` cites "the
  leaf 06 inventory" → `docs/generated/harness-controls.md:724`.
- `scripts/lint-ratchet/lint-ratchet-config.ts:405` — the matching
  `zeroBaselineDisposition.reason` cites it too; not rendered (shadowed by
  `exitPath` at `:406`).
- `scripts/lint-ratchet/lint-ratchet-config.ts:420` — same `principle` for
  `no-node-access` → `docs/generated/harness-controls.md:738`.
- `scripts/lint-ratchet/lint-ratchet-config.ts:423` — matching `reason`; not
  rendered (shadowed by `exitPath` at `:424`).
- `scripts/lint-ratchet/lint-ratchet-config.ts:459` — `"... now that the final
  Leaf 41g test rows are linted."` → `docs/generated/harness-controls.md:766`.
- `scripts/lint-ratchet/diagnostics.ts:196` — ``why: `Ratchet regression:
  ${entry.principle}` ``. The same four `principle` strings reach an agent as
  the regression envelope's `why`, not only a human reader as documentation.
- `docs/generated/harness-controls.md:752` and `:780` — `lint-review-2026-06
  leaf 03e`, rendered from the drift-ai `expect-expect` / `valid-expect`
  principles. These two *are* pack-qualified and are the shape the others should
  take.

**Correction — this section's central claim is wrong in both directions, and
the priority inverts.** Re-traced on `2cf49496` by
[SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) (correction 1), which
supersedes the two bullets above:

- **The four `principle` strings do *not* reach the agent envelope.**
  `buildLocalFinding` (`scripts/lint-ratchet/diagnostics.ts:182-196`) reads the
  *local ESLint rule's* docs metadata — `ruleDocsById.get(regression.ruleId).principle`
  — not the registry entry. `:157` is
  `ratchet/local-no-swallowed-errors-broader-semantics` (`ruleId:
  "local/no-swallowed-errors"`), so it takes that path. The `principle` strings
  reach `docs/generated/harness-controls.md` and nothing else.
- **The two `zeroBaselineDisposition.reason` strings at `:405` and `:423` do
  *not* "render nowhere".** `buildGenericFinding` (`diagnostics.ts:207-225`)
  reads `ratchet.zeroBaselineDisposition?.reason` for `third-party` and `core`
  ratchets, and both of these sit on `source: { kind: "third-party" }`
  testing-library ratchets. **They are the strings an agent reads today** — the
  most urgent two, not the inert two.
- **Two sites this inventory misses**, added by the plan's correction 3:
  `scripts/lint-ratchet/lint-ratchet-config.ts:479`
  (`ratchet/vitest-valid-expect-script-tests`, "while Leaf 41 drain work
  proceeds") and `harness.controls.json:1722` (`check/lint-coverage-map`, "the
  Leaf 41 lint coverage map"). S12 covers eight strings, not six.

Both sets still need fixing, and editing either field moves no baseline —
`configHashInput` (`tools/lint-ratchet/src/kernel/baseline-hash.ts:92-107`)
hashes neither, so **no `lint:ratchet:update` is required**.

### Bare coordinates in source comments

- `scripts/lint-ratchet/lint-ratchet-config.ts:33` — "testing-library
  implementation-detail debt floors (leaf 06)".
- `scripts/lint-ratchet/lint-ratchet-config.ts:170` — "moved to the tools/
  workspace (leaf 02)".
- `scripts/lint.sh:44` — "leaf 76 measured the final split at 3.381 GiB…" (the
  measurement itself is load-bearing; only the coordinate is unresolvable).
- `scripts/sensor-knip-unused-exports-baseline.ts:20` — "a visible change
  (leaf 61)".
- `scripts/lib/verify-metadata-core.ts:3` — "(backlog leaf 05)".
- `scripts/harness/verify-step-schema.ts:100` — "(Mirrors leaf 23.)".
- `scripts/drift/locator-usage.ts:22` — "retired with the selector ratchets
  (leaf 03g)". The same file's `:6` already spells it
  `lint-followups-2026-06 leaf 03g`, so the qualifier is one line away.
- Five `leaf 50 step 2` sites resolving to
  `docs/agent_notes/backlog/lint-deep-dive-2026-07/50-suppression-registers-into-commit-gate.md`:
  `scripts/suppression-ledger-baseline.ts:1`, `scripts/suppression-ledger-core.ts:1`,
  `scripts/suppression-ledger-identity.ts:1`, `scripts/eslint-disable-register.sh:128`,
  `scripts/suppression-register.sh:130`.
- Two `leaf 40 step N` sites resolving to
  `docs/agent_notes/backlog/lint-deep-dive-2026-07/40-restricted-syntax-additive-composition.md`:
  `eslint-config/restricted-syntax-policy.js:101` ("Recorded policy decision
  (leaf 40 step 3)") and `eslint-rules/restricted-syntax-and-globals-config.test.js:185`.
- `scripts/drift-ai/prototype-advisory.ts:22-23` — "Task 39 owns this contract;
  task 38 owns the … DATA". 48 `task NN` occurrences across 27 non-test `.ts`
  files in `scripts/drift-ai/`.
- `packages/server/src/socket/broadcast-registry.ts:106` — "Migration recipe
  (DX5.3c-DX5.3f follow this shape):" in a live source JSDoc.
- Nine `ux-audit P0-3` sites: `packages/server/src/utils/encounter-hp-log.ts:5`,
  `packages/server/src/services/rest-encounter-attribution.ts:8`,
  `packages/server/src/services/character-live-state/encounter-attribution.ts:8`,
  `packages/server/src/services/rest-encounter-attribution.test.ts:9`,
  `packages/server/src/services/rest-service.test.ts:206`,
  `packages/server/src/routers/encounter-hp-attribution.test.ts:18`,
  `e2e/encounter-combat.spec.ts:668`,
  `eslint-config/max-lines-exceptions.baseline.json:158` (inside a committed
  `reason` field, not a source comment), and
  `docs/generated/observed_flaky_tests.md:85` (an incident-log line, "failed
  twice on 2026-06-13 while landing ux-audit P0-3", with two bare `P0-3`
  back-references at `:103` and `:105`). The last one sits under
  `docs/generated/` but is not a section-2 generated leak:
  `docs/generated/README.md:12` records it as hand-maintained with "no generator
  or content-freshness gate", and `scripts/ai-hooks/protected-files.sh:113-116`
  exempts it from the generated-file write guard for that reason.
- `docs/agent_notes/ux-audit-2026-06-06.md:87` — "### 3. PC hit points: sheet and
  encounter share one value with no event surfacing", under "## P0" at `:50`.
  This is what `P0-3` numbers, and no comment site names it.

### The model to copy, and near-misses

- `scripts/lib/atomic-write.ts:4-7` — cites `lint-arch-review leaf 14` *and*
  spells out `docs/agent_notes/backlog/lint-arch-review-2026-07/14-enumerated-subpath-exports.md`.
  This is the target shape.
- `scripts/lib/process-argv.ts:3-4` (`ready-2026-07 leaf 16`) and
  `scripts/lib/codepoint-compare.ts:4-6` — both already carry a resolvable pack
  qualifier. Leave them; they are the shape to copy, not sites to change.
- `scripts/lib/eslint-json.ts:4-5` — pack-qualified in form, but the path it
  spells does not exist: "`docs/agent_notes/backlog/` `lint-ratchet-arch` review
  pack `14-enumerated-subpath-exports.md`", and `docs/agent_notes/backlog/` has
  no `lint-ratchet-arch` directory. This is a site to change, not a model:
  correct it to
  `docs/agent_notes/backlog/lint-arch-review-2026-07/14-enumerated-subpath-exports.md`,
  the spelling `atomic-write.ts:4-7` and `codepoint-compare.ts:4-6` already use.

### Anchors to deleted code

- `tools/lint-ratchet/src/git-rail/info-attributes.ts:7` — "Behavior mirrors the
  previous awk exactly:".
- `:40-41` — "matching awk's `$1` (which skips any leading whitespace before the
  first token)". Note the parenthetical already states the real rule.
- `:79-80` — "the branch set matches the previous awk rules line for line".
- `:112-113` — "the awk read loop never saw that phantom line".
- `:166-167` — "matching the awk `printf '\n'` before the block".
- `:3` — the file header carries the unqualified `leaf-04` id.
- `scripts/git/baseline-merge-driver-lib.sh:4` — the surviving sibling says only
  "The .git/info/attributes block-rewriting lives in TypeScript"; the awk source
  is gone from the tree (removed in `8b1f3adc`).

### Prose that has diverged from the code

- `scripts/harness-check.ts:17-20` — the `freshness:` bullet names nine
  surfaces. `harness.controls.json` declares eleven `generatedSurface` entries;
  the two omitted are `doc-generator/baseline-conflict-recipes`
  (`harness.controls.json:1125`) and `doc-generator/lint-coverage-map`
  (`harness.controls.json:1151`). `checkGeneratedFreshnessOutputs`
  (`scripts/harness-check.ts:90`, called at `:140`) already derives the real
  list at runtime.
- `packages/server/src/services/README.md:220`, `:222-223` — "### Deferred
  convergence follow-ups" / "These are tracked but intentionally not done in this
  doc-first pass".
- `packages/server/src/services/README.md:225` and `:232` — both bullets are
  "**Rename ambiguity (done):**" and "**`executeLongRest` reorder (done):**".

### Restatement and placement (separable cluster)

- `packages/server/src/routes/upload-routes.ts:12-16` — header bullet 1: the
  `saveMapImage` try/catch "is the ONLY thing that turns the service's plain
  `new Error(...)` validation failures into a deliberate HTTP 400."
- `packages/server/src/routes/upload-routes.ts:167-170` — the inline comment at
  the catch says the same thing and points back at the header. Header bullets 2
  (`:17-21`, the `assertCampaignDm` 403 remap, implemented at `:158-162` with no
  inline comment) and 3 (`:22-24`) have no inline counterpart.
- `scripts/harness/harness-diagnostics-output.ts:5-9` — the header states both
  "the contract is validated in exactly one place" and that the union's four
  modes are dispatched "one arm each with a `never` default".
- `scripts/harness/harness-diagnostics-output.ts:55-68` — the route union's
  JSDoc re-enumerates the four modes, with per-mode descriptions the header
  lacks.
- `scripts/harness/harness-diagnostics-output.ts:130-141` —
  `writeRenderedEnvelope`'s JSDoc re-explains the `never` default, plus the
  non-recoverable reason for inlining `assertNever` (`:137-140`).
- `scripts/drift-ai/prototype-advisory.ts:25-26` — the comment documenting
  `PROTOTYPE_ADVISORY_LANE`; `:27` is the file's only import; `:29` is the
  constant. The import physically separates the two.

### `harness-check.ts` failure-reporting split (the medium half)

- `scripts/harness-check.ts:124`, `:127`, `:143`, `:146` —
  `checkManifestReadTripwire`, `checkRegistrationPreflightWiring`,
  `checkPortingKnobParity`, `checkPrePushScopePin` return failure strings that
  `main()` loops and labels via `pushFailure` at the call site.
- `scripts/harness-check.ts:140`, `:141`, `:142`, `:162` —
  `checkGeneratedFreshnessOutputs`, `checkFixtureCopyClosure`,
  `checkGeneratedHookWiringStructure`, `checkCiGateParity` take the `failures`
  map and label internally; two of them — `checkFixtureCopyClosure` and
  `checkCiGateParity` — live in `scripts/harness/fixture-closure-check.ts` and
  `scripts/harness/harness-gate-parity.ts` (imported at `:30` and `:32`, while
  the other two are defined locally at `:90` and `:104`), so a bucket label
  lives in a different file depending on which convention a check picked.

## Proposed direction

Ordered so the highest-value, lowest-risk work lands first. Each numbered step
is one commit.

1. **Fix the six lint-ratchet metadata strings (four of them live in the
   generated doc).** In `scripts/lint-ratchet/lint-ratchet-config.ts`, rewrite
   the `principle` / `reason` text at `:157`, `:402`, `:405`, `:420`, `:423`,
   `:459` so it states the rule rather than the coordinate ("beyond the current
   inventory", "the inventory this floor was set from"), or qualifies the
   coordinate the way `lint-review-2026-06 leaf 03e` already does at
   `:752`/`:780` of the generated doc. Fix the two currently inert `reason`
   strings too — deleting them from scope leaves the defect armed behind an
   `exitPath` that a later config edit can drop. Regenerate
   `docs/generated/harness-controls.md` and run `bun run harness:check`. Read
   [`docs/guides/lint-ratchet.md`](../../../guides/lint-ratchet.md) first —
   these are ratchet metadata fields, not free prose.
2. **Add a parity guard so it cannot recur.** Extend `bun run harness:check`
   with a check that rejects an unqualified backlog coordinate (`leaf <N>`,
   `task <NN>`, a bare `P<n>-<n>`) in any `principle` or
   `zeroBaselineDisposition.reason` field of the lint-ratchet registry, whether
   or not `docs/generated/harness-controls.md` currently renders it. Scoping the
   guard to what the generator renders today would leave `reason` permanently
   unguarded and let step 1's fix silently regress; both consumers matter — the
   doc and the `scripts/lint-ratchet/diagnostics.ts:196` regression envelope.
   This is the highest-value part of the whole leaf: it makes step 1 permanent
   and costs one rule. Run `bun run harness:check` and `bun run harness:audit`
   after.
3. **Fix `scripts/harness-check.ts:17-20`** (trivial, do it regardless of the
   rest). Replace the hand-typed nine-surface enumeration with a sentence
   pointing at the `generatedSurface` entries in `harness.controls.json` as the
   source of truth, since `checkGeneratedFreshnessOutputs` already derives the
   real list at runtime.
4. **Fix the "Deferred convergence follow-ups" section in
   `packages/server/src/services/README.md`.** Collapse `:220-237` to the two
   conventions it actually establishes (the depth-signalling `run*Core` naming,
   and `(ctx, character, input)` argument order) and delete the "intentionally
   not done" framing and the historical rationale for both `(done)` items.
5. **Rewrite the five awk references** in
   `tools/lint-ratchet/src/git-rail/info-attributes.ts` (`:7`, `:40-41`,
   `:79-80`, `:112-113`, `:166-167`) as statements about observable output. Half
   the work already exists: `:40-41` parenthesizes the real rule ("skips any
   leading whitespace before the first token"); promote the parenthetical and
   drop the awk clause. Qualify or drop `leaf-04` at `:3`.
6. **Convert the resolvable ids to doc paths, do not delete them.** Where a
   coordinate resolves — `broadcast-registry.ts:106` (`DX5.3c-DX5.3f`, resolvable
   via `docs/agent_notes/finished_work/socket-emit-inventory.md`, which the same
   JSDoc already links twenty lines below at `:126-127`),
   `verify-metadata-core.ts:3`, `verify-step-schema.ts:100`,
   `locator-usage.ts:22`, `sensor-knip-unused-exports-baseline.ts:20`,
   `lint.sh:44`, `lint-ratchet-config.ts:33`/`:170`, the five `leaf 50 step 2`
   sites and the two `leaf 40 step N` sites — replace the bare id with the pack
   path, following `scripts/lib/atomic-write.ts:4-7`. Also correct
   `scripts/lib/eslint-json.ts:4-5`, which already has the shape but names a
   `lint-ratchet-arch` pack that does not exist; point it at
   `docs/agent_notes/backlog/lint-arch-review-2026-07/14-enumerated-subpath-exports.md`.
   - `ux-audit P0-3` resolves, but to a document its own wording sends a reader
     away from: qualify it with `docs/agent_notes/ux-audit-2026-06-06.md`
     (finding 3 under "## P0"), and restate the fact it stands in for (HP-write
     attribution for a character in an active encounter), since that doc states
     two candidate fix directions rather than the rule the code settled on.
     Eight of the nine sites are ordinary hand edits, including
     `docs/generated/observed_flaky_tests.md:85` and its `:103`/`:105`
     back-references — that file is hand-maintained
     (`docs/generated/README.md:12`), so edit it directly and do not route it
     through a generator or through step 2's guard.
     `eslint-config/max-lines-exceptions.baseline.json:158` is the one exception:
     a committed baseline `reason` field that goes through the baseline flow
     (`scripts/git/max-lines-exceptions-merge-driver-lib.sh`, the post-merge
     truth-up, `bun run lint:max-lines-exceptions:update`), not a hand edit.
   - The `scripts/drift-ai/` `task NN` refs are deleted-pack refs, not dangling
     ones, so qualify them by pack. Next-items ids (15, 30, 38-48 and letter
     suffixes — `prototype-advisory.ts:2,22,57`, `types.ts:21,85,102`,
     `class-construction*.ts`, `test-orphaning-*.ts`, `coverage-*.ts`,
     `clone-candidates.ts`, `minhash-lsh.ts`, `sibling-naming.ts`,
     `dolos-advisory.ts`, `semgrep-advisory.ts`, `branch-points.ts`,
     `birth-size-delta-complexity.ts`, `env-define-matrix-config.ts`,
     `config.ts:116,131`) get a `drift-ai-next-items` prefix plus a pointer to
     the close-out summary `docs/agent_notes/finished_work/drift-ai-next-items.md`,
     which names the pack and states that the individual leaves live in git
     history before `9c860c7f`. That summary is pack-level and does not
     enumerate leaves by number, so where the leaf text itself is load-bearing
     (`prototype-advisory.ts:22-23`'s output contract, for one), restate the
     contract in the comment as well as qualifying the id.
   - drift-ai-tasks ids (`hotspots.ts:7,10`, `harness-freshness.ts:113`,
     `harness-freshness.test.ts:186`, `subcommand-args.ts:6,8`) have **no**
     archive summary in `finished_work/`; their only in-tree trace is
     `docs/agent_notes/LOG.md` (`:456` for the hotspots lenses, `:604` for the
     adapter policy). Restate the fact and, where the provenance is worth
     keeping, cite `docs/agent_notes/LOG.md` plus the removal commit `7c560a8d`
     rather than a bare `task NN`.
7. **Trim the two self-restating headers.** In
   `packages/server/src/routes/upload-routes.ts`, reduce header bullet 1
   (`:12-16`) to a pointer at the catch and keep `:167-170` verbatim — the
   inline copy is the one a reader hits at the moment it matters. In
   `scripts/harness/harness-diagnostics-output.ts`, cut `:5-9` to the
   single-gate sentence, keeping `:55-68` and `:130-141` untouched.
8. **Move one comment.** `scripts/drift-ai/prototype-advisory.ts`: move `:25-26`
   below the import so it sits directly above `PROTOTYPE_ADVISORY_LANE`. No
   follow-on sweep — see caveats.
9. *(Separable, medium.)* **Pick one failure-reporting convention in
   `scripts/harness-check.ts`.** Make every check return failure strings and let
   `main()` label them at the call site (the `:124`/`:127`/`:143`/`:146` shape),
   so bucket labels stop living in `scripts/harness/fixture-closure-check.ts`
   and `scripts/harness/harness-gate-parity.ts`. Touches `scripts/harness-check.ts`
   plus those two imported check modules and their tests; TDD applies normally —
   the harness-check tests already assert bucket labels, so change them first.

## Scope / caveats

- **`DX5.3c-DX5.3f` resolves — it is step 6 work, not deletion work.** `DX5`
  appears 27 times across `docs/agent_notes/LOG.md`,
  `docs/agent_notes/finished_work/README.md`, and
  `docs/agent_notes/finished_work/socket-emit-inventory.md`, which
  `broadcast-registry.ts:126-127` already links twenty lines below the citation.
  Convert the id to that path.
- **Do not blanket-delete ticket ids.** Most of them *do* resolve to in-repo
  docs (`docs/agent_notes/LOG.md`,
  `docs/agent_notes/finished_work/socket-emit-inventory.md`,
  `docs/agent_notes/backlog/codebase-audit/08-…md`). Deleting them destroys
  traceability that the comment was carrying. The remedy is "qualify with a
  path", not "remove".
- **`scripts/lib/cli.ts:74-80` is not archaeology — compress it, do not delete
  it.** The `S1 spike record (arch-plans-2026-07 leaf 02)` paragraph ends with
  "parseArgs remains a tokenizer we deliberately do not use", which is a
  standing prohibition preventing a future agent from re-attempting the
  `node:util` rewrite that `cli.test.ts` already pins as broken. Keep the
  prohibition and the list of concrete mismatches; the id is already
  pack-qualified.
- **Do not fold `scripts/lib/process-argv.ts`,
  `scripts/lib/codepoint-compare.ts`, and `scripts/lib/eslint-json.ts` into a
  shared barrel.** `codepoint-compare.ts:6-9` and `eslint-json.ts:8-10` both
  state that every `scripts/` consumer imports from *here* "so the utility seam
  stays one file wide on the adapter side"; a barrel re-couples the three seams
  and drags the kernel's `eslint-json` types into every `codepoint-compare`
  consumer. Correct the `eslint-json.ts:4-5` pack path and trim the comments;
  leave the seams themselves alone.
- **`scripts/harness/harness-diagnostics-output.ts` is deliberate, recently
  reviewed work.** It is 202 lines, roughly 113 comment and 74 code. Step 7 is a
  two-sentence trim of the header and nothing more. If line count ever becomes
  the concern, the 24-line `source`-convention JSDoc at `:75-98` is the
  candidate, not the exhaustiveness comments — but it is currently earning its
  length.
- **Preserve the measurement in `scripts/lint.sh:44`.** "3.381 GiB versus 4.095
  GiB monolithic", the `--concurrency=2` 8.14 GB figure, and the OOM note are
  load-bearing operational facts. Only the `leaf 76` coordinate is at issue.
- **Preserve `upload-routes.ts` header bullets 2 and 3.** Bullet 2 (the
  deliberate `TRPCError` → flat HTTP 403 remap, cross-referencing
  [`docs/authorization.md`](../../../authorization.md)) and bullet 3 (which
  multipart errors keep their native status) have no inline counterpart and are
  the only record of those decisions. Step 7 touches bullet 1 only.
- **Do not re-open the `encounter-map.ts` transaction prose in
  `services/README.md`.** `map-tokens/` owns those transactions now
  (`services/map-tokens/participant-links.ts:64,129,183`,
  `token-lifecycle.ts:88,110`), `README.md:192-196` describes that delegation
  correctly, and `:212` already scopes the "trivial batched `$transaction([...])`"
  caveat to `auth.ts`'s session rotate as the only remaining case. Step 4 is
  confined to `:220-237`.
- **`prototype-advisory.ts` needs no follow-on sweep.** Across all 344 `.ts`
  files in `scripts/drift-ai/` (240 non-test), this is the only one where the
  line immediately preceding the first import is a declaration doc comment. The
  one near-miss is `scan-provenance.ts:1-3`, whose preceding line is the second
  line of an ordinary two-line file header rather than a declaration doc — do
  not re-flag it. Most of the directory does not use a header at all (219 of 344
  files import on line 1; only 112 open with a comment), so there is no
  directory-wide "file-header-then-import" convention to preserve here. One line
  moves; nothing else. Reproduce with:

  ```sh
  for f in scripts/drift-ai/*.ts; do
    awk -v F="$f" 'NR>1 && !found && /^[ \t]*import[ ({*]/ {
      found=1; if (prev ~ /^[ \t]*\/\// || prev ~ /\*\//) print F":"NR
    } {prev=$0}' "$f"
  done
  ```

- **Re-count before scoping steps 1 and 6**, excluding `packages/server/dist/`
  build output — naive greps are inflated by it.
- **Step 9 is the natural split point.** It is a code-structure change, not a
  comment change, and shares only the leaf's diagnosis with the rest. If this
  lands incrementally, break there.
- Related: leaf 45 covers the adjacent case where a comment states a *contract*
  that lives away from the code that types it, including one header that claims
  a compile-time guarantee the types do not provide. No ordering dependency
  between the two, but they touch `packages/server/src/` prose in different
  files and should not be worked concurrently by two agents.
