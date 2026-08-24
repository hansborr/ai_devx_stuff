# 111. Lint-coverage policy lives as 186 hand-maintained rows in a generated-directory Markdown file that a checker reverse-parses through a private glob dialect

Status: Landed on fix/cq-111
Theme: typed manifest single-sourcing · Area: harness · Severity: high · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`docs/generated/lint-coverage-map.md` is three things at once: a presentation
document, the hand-maintained source of truth for lint-coverage policy, and —
for exactly one marker-delimited block — generator output. Its own header calls
this "hybrid ownership". The policy half is not passive prose:
`scripts/lint-coverage-map-check.ts` reads the Markdown back at runtime, splits
each `|`-delimited line at fixed column offsets, and interprets the code spans
in the first cell through a stateful, order-dependent grammar plus a private
brace-expansion/glob-to-regex engine. The document's *meaning* therefore
depends on Markdown cell order, code-span ordering within a cell, and a glob
dialect that exists nowhere else in the repo.

This costs contributors three ways. First, an ordinary documentation edit —
reflowing a cell, reordering code spans, adding a column — can silently change
or break lint-coverage semantics, because the prose is the policy engine's
input; editing the doc safely requires knowing the parser's internals. Second,
the file sits under `docs/generated/`, which everywhere else in this repo means
"do not hand-edit", yet 186 of its 187 data rows are hand-maintained — the
location actively misleads. Third, the private glob dialect (implicit `**/`
prefixing, inherited base directories, duplicate-extension normalization) is a
semantic fork of the canonical ratchet matcher, which is deliberately identical
to ESLint flat-config semantics; the same pattern text can mean different file
sets in the coverage map and in the lint config it describes. For a repo whose
stated goal is to be a copyable public harness reference, a Markdown-reverse-
parsing policy engine is the sole counterexample to its own flagship
single-sourcing pattern (`eslint-config/config-surface-manifest.json`,
`harness.controls.json` generated surfaces, generated verify steps).

## Evidence

- `scripts/lint-coverage-map-check-patterns.ts:3-6` — `PATH_COLUMN = 0`,
  `NORMAL_LINT_COLUMN = 2`, `RATCHET_COLUMN = 3`, `STATUS_COLUMN = 6`: policy
  fields are addressed by fixed Markdown table offsets. `parseRows` (`:30-51`)
  extracts them from raw `|`-prefixed lines.
- `scripts/lint-coverage-map-check-io.ts:10` and `:31` — the checker's input
  is `docs/generated/lint-coverage-map.md`, read with `readFileSync`;
  `scripts/lint-coverage-map-check.ts:80` feeds that text to `parseRows`. The
  document is a runtime policy input, not just presentation.
- `scripts/lint-coverage-map-check-patterns.ts:53-99` — `extractPathPatterns`
  mutates a `base` string as code spans are consumed in order
  (`stableBaseForPattern`, `shouldUpdateBase`, `resolvePatternSource`): a
  genuinely stateful grammar over code-span sequence. `resolvePatternSource`
  (`:73-82`) also prefixes `**/` implicitly and special-cases the literal
  string `bunfig.toml` (`:77`).
- `scripts/lint-coverage-map-check-patterns.ts:101-157` — a private glob
  engine: `expandBraces` (`:101-113`), duplicate-extension normalization
  (`:9`, `:115-122`), `globVariantToRegExp` (`:128-152`), `createMatcher`
  (`:154-157`).
- `tools/lint-ratchet/src/kernel/ratchet-globs.ts:1-16` — the canonical
  matcher: minimatch with `dot: true`, documented as deliberately identical to
  ESLint flat-config resolution; `matchesRatchet` exported at `:48`.
  `scripts/lint-coverage-map-gen.ts:3` already imports it — the two dialects
  coexist inside one file family.
- `scripts/lint-coverage-map-gen.ts:14-33` — the generator reads its own
  current output (`readCurrentOutput(outputPath)` at `:29`) and splices only
  the drift-ai block back into it (`spliceDriftAiCoverageBlock`), the only
  splice-shaped doc-generator facet in the repo.
- `docs/generated/lint-coverage-map.md:13-18` — the header: "this file has
  hybrid ownership … every other row and all policy prose remain
  hand-maintained." Measured at the pin: 227 `|`-prefixed table lines, of
  which 187 are data rows; 186 are hand-maintained and 1 sits inside the
  generated markers (`:228-232`).
- `scripts/lint-coverage-map-check-suggest.ts:95-98` — the `--suggest` helper
  emits instructions of the form "append the bare filename … to the
  `Path / group` cell of the existing row at line N": tooling output is
  Markdown-row mechanics keyed to line numbers.
- `harness.controls.json:1175-1205` — the existing
  `doc-generator/lint-coverage-map` facet (invocation
  `bun run docs:lint-coverage-map:generate`, checkScript
  `docs:lint-coverage-map:generate:check`): the regeneration home for a
  full-document renderer already exists.
- `package.json:121-125` — the five entry points (`docs:lint-coverage-map:`
  `check`/`audit`/`generate`/`generate:check`/`suggest`) all route through
  this family; `ls scripts/lint-coverage-map*` counts 13 files.

## Proposed direction

Make a typed manifest the sole coverage-map policy source, match membership
only through the canonical ratchet matcher, and generate the complete Markdown
document from structured data. Target design, then a three-slice plan.

**Target design.**

- A TS-module manifest validated by a Zod schema (per the repo's "shared Zod
  schemas are the contract" convention; `scripts/lint-ratchet/lint-ratchet-config.ts`
  is the precedent for a typed TS registry that imports shared glob constants
  from `eslint-config/shared-policy.js`). Entries carry: a stable per-entry id,
  a section enum, explicit repo-rooted minimatch globs, and asserted policy
  fields (status enum, proposed rule/tool, blocker/follow-up, prose notes).
  Checkable facts — normal-lint reach, ratchet ids — are validated against the
  `lintRatchets` registry, not free text.
- Organize the checker around a derived/asserted split: everything computable
  (Files counts, ESLint reach, the drift-ai table) is rendered and verified at
  generation time; the manifest asserts only genuine policy.
- All membership goes through `tools/lint-ratchet/src/kernel/ratchet-globs.ts`
  (minimatch `dot: true`, ESLint-flat-config-identical). The entire private
  dialect in `scripts/lint-coverage-map-check-patterns.ts` — base-directory
  grammar, `expandBraces`, `globVariantToRegExp`, duplicate-extension
  normalization — is deleted, not ported. `trackedFileIsInScope` (`:159-167`)
  survives: it is real scope policy, not dialect.
- `scripts/lint-coverage-map-gen.ts` converts from splice-one-block to
  rendering the complete `docs/generated/lint-coverage-map.md` through the
  existing `doc-generator/lint-coverage-map` facet, making every doc-generator
  facet uniform and deleting the "hybrid ownership" header. Policy prose
  (status-value docs, membership rules, per-row rationale) moves into manifest
  fields and template text so nothing is lost in the cutover.
- `docs:lint-coverage-map:suggest` emits ready-to-paste manifest entries keyed
  by stable entry id instead of Markdown rows and "append at line N" targets.
- Where coverage-map scope coincides with ESLint scope, the manifest imports
  the shared glob constants from `eslint-config/shared-policy.js`, so the two
  co-move instead of drifting.

**Plan (one slice per landable unit; L, needs-split as three leaves of work).**

1. **Manifest extraction + dual-run parity harness.** Mechanize extraction by
   running the *current* `extractPathPatterns` over the live document to
   produce the frozen resolved-pattern set — scripted, never hand-transcribed.
   Translate each resolved pattern to an explicit repo-rooted minimatch glob,
   then prove per-file membership equivalence between old matcher and new over
   the full `git ls-files` universe. Keep the parity check running in the gate
   for as long as both representations exist.
2. **Checker cutover.** Rewire `lint-coverage-map-check.ts` (and `--audit`)
   onto the manifest: rows come from typed entries, membership from
   `matchesRatchet`-style canonical matching, ratchet/status validation from
   the schema and registry. The Markdown parser still exists but is now only
   the parity counterparty.
3. **Full-document renderer + deletion.** Convert the generator to render the
   whole document from the manifest, retarget `--suggest` to emit manifest
   entries, delete `parseRows`/`extractPathPatterns`/the private glob engine
   and the splice layer, drop the parity harness, and regenerate the facet
   data (`bun run verify:steps`, then `bun run harness:check` after the
   `harness.controls.json` surface changes, per the manifest-touch rule).

## Scope / caveats

- **Out of scope:** changing what the coverage map actually says. This is a
  representation change; the policy content of the 186 rows is carried over.
- Binding rulings from panel review:
  - Do not stop at explicit-rooted-globs-in-Markdown as the end state;
    Markdown-as-policy-source is the defect, not just the glob dialect — carry
    through to the typed manifest with full-document generation.
  - Parity is the deletion license: never delete or replace the private glob
    engine without the slice-1 dual-run proof (scripted freeze of the current
    `extractPathPatterns` output, membership equivalence over `git ls-files`).
  - Membership changes discovered during glob translation must not land
    silently inside the migration; each intentional correction is an explicit,
    separately-reviewed manifest edit.
  - The interim window between manifest extraction and checker cutover must
    stay gated by the dual-run parity check.
  - No raw JSON manifest: a TS module with a Zod schema, so entries can import
    shared glob constants and carry typed rationale prose.
  - Do not port the base-directory grammar, implicit `**/` prefixing, or
    duplicate-extension normalization into the manifest world; explicit
    repo-rooted globs matched only through the canonical matcher.
    `trackedFileIsInScope` survives as scope policy.
  - `docs:lint-coverage-map:suggest` must not keep emitting Markdown rows or
    line-number targets.
- **Sequencing with the prior pack (CQ25-44):** the 2026-07-25 pack's
  [`28-PLAN.md`](../code-quality-2026-07-25/28-PLAN.md) slice 28.11 relocates
  this same 13-file `lint-coverage-map` family ("last — the most entangled",
  retaining both check and generator facades). That slice is strictly a file
  move: it does not touch source-of-truth, the Markdown-as-policy parsing, or
  the glob dialect, so it neither covers nor declines this leaf. Land this
  change strictly before slice 28.11 or fold it into that slice's atomic
  move — never interleaved. Its facade-preservation rule carries over here:
  retain the `docs:lint-coverage-map:*` script facades across the cutover.
- **Real risk in slice 1:** the dialects genuinely differ (implicit `**/`
  prefixing, inherited bases, `.ext.ext` normalization, the private `?`/`{}`
  handling), so glob translation is not mechanical; expect a handful of
  patterns whose literal translation changes membership — those become the
  explicit manifest edits above, not silent fixes.
- Land after
  [251-remove-closed-implementation-residue-from-the-active.md](./251-remove-closed-implementation-residue-from-the-active.md),
  whose full-document truth pass removes stale policy prose before this leaf
  migrates that corrected content into the typed manifest and renderer.
- Coordinate with
  [157-shared-policyjs-grab-bag-unrelated-lint.md](./157-shared-policyjs-grab-bag-unrelated-lint.md):
  if leaf 157 lands first, import shared lint globs from its focused path/glob
  vocabulary module; if this leaf lands first, leaf 157 must retarget the new
  manifest importer when it deletes `shared-policy.js`. Do not recreate a
  compatibility barrel.

## Landed outcomes and deferrals (review round 1)

The migration landed as planned; these are the decisions taken where the target
design and the binding rulings pulled against each other, recorded so the next
reader does not re-derive them.

- **`Files` counts are checked, not derived.** The target design wanted them
  rendered. They cannot be: four rows deliberately count a subset (a sibling
  row owns the rest of the same glob and rows carry no `ignores`) and one is a
  narrative breakdown, so rendering the derived number would change what the map
  says and narrowing the globs would change membership — both reserved above.
  Instead `:check` derives the count and compares: every row without an explicit
  `filesCountNote` must match the tree. Six counts that had already rotted were
  corrected in their own commit.
- **`ratchets` stays prose, but the lex is total.** Structuring ratchet ids into
  a field alongside the rendered prose would duplicate the claim in two places;
  the cells interleave non-ratchet floors, `;`-joined clauses and
  parentheticals. The evasion that mattered — a ratchet-shaped reference the
  checker's id lexer cannot see, which renders as a claim and validates as none
  — is refused by the schema instead.
- **ESLint reach is checked in both directions**, and "reach" means at least one
  rule resolves. `calculateConfigForFile` returns a config for any file with a
  known extension, so the weaker test made the non-`linted` direction vacuous.
- **Shared glob constants are not imported yet.** The target design's
  "manifest imports the shared glob constants" element is unimplemented. Only
  two of the 475 globs are textually identical to a `path-glob-policy.js`
  export (`eslint-config/*.js` = `eslintConfigSupportFiles`,
  `packages/client/src/**/*.{ts,tsx}` = `clientSourceFiles`); the interesting
  ones already diverge (`packages/shared/src/**/*.ts` against
  `sharedSourceFiles`'s `{ts,tsx}`, and the shared-test row omits the
  `*test-helper*` pattern that `path-glob-policy.js` includes), so adopting them
  is a membership change and belongs in its own reviewed edit under the ruling
  above. Importing just the two identical ones would make two pure data modules
  depend on `config-surfaces.js`, which reads `config-surface-manifest.json`
  from disk at import time, and would pull three more files into the generator
  smoke's fixture closure — too much coupling to single-source two strings.
  Revisit when a shared-glob adoption pass takes the membership changes too.
- **Known open discrepancy:** none of the coverage rows disagree with ESLint
  reach at the pin, but `examples/lint-ratchet-demo/eslint.config.js` and
  `examples/lint-ratchet-demo/eslint-rules/no-console-log.js` do resolve a root
  ESLint config object (with zero rules) despite `examples/` being ignored.
  Harmless under the rules-based probe; worth a look if that ignore is ever
  tightened.
