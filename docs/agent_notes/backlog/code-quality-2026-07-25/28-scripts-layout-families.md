# 28. The scripts/ layout contract is prose-only: flat implementation families, a fixtures-only directory, and 344 unmapped drift-ai files

Status: Proposed — not promoted
Theme: scripts layout and navigability · Area: harness · Severity: medium · Size: XL

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`scripts/README.md:42-44` states a hard rule — "Do not add a new implementation
family as `scripts/<topic>-*.ts` or `scripts/<topic>-*.sh`. Add `scripts/<topic>/`
and keep only the package-facing entrypoint or facade at the top level." Nothing
enforces it. There is no path-policy subject, no harness check, and no local
ESLint rule that reads that rule; a search across `scripts/path-policy/`,
`scripts/harness/`, and `eslint-rules/` returns zero references to it. The
predictable result is that the rule has been silently outvoted by the tree: seven
flat implementation families sit at the top level with no owner directory at all,
and the set is still growing. `suppression-ledger` is the demonstration — ten flat
files, entrypoint plus five implementation modules plus four colocated tests,
added on 2026-07-25 (`6e2692eb`, merged at `8220ec4f` the same day) with nothing
in the tree to flag them.

The same absence of an enforced layout shows up one level down, in two different
shapes. Inside `scripts/harness/` — a directory that already *is* the owner
directory — fourteen files re-prefix `harness-` onto their own names while 50
siblings drop it, so the same concept is spelled two ways within one folder. And
the `harness:audit` tool is split across three locations: implementation at
`scripts/harness-audit.ts`, test at `scripts/harness/harness-audit.test.ts`,
fixtures at `scripts/harness-audit/` — a directory holding nothing but fixtures.
Meanwhile `scripts/drift-ai/` has 344 `.ts` files (57,180 lines) in one flat
directory with no `MODULE.md`, while its smaller sibling `scripts/drift-triage/`
(28 files) has one and names its clusters.

The single underlying cause is that the layout contract lives only as prose in a
README that nothing reads back. Each individual violation is cheap; together they
mean a maintainer landing in `scripts/` cannot tell from the tree which files
belong to which tool, and the README no longer describes the repository.

## Evidence

- `scripts/README.md:42` — the family rule, verbatim and unenforced.
- `scripts/README.md:27-30` — the countervailing allowance: "A direct companion
  for a top-level entrypoint … When companions become a family, move them under
  a directory instead."
- Flat implementation families at the `scripts/` top level, none of which has a
  `scripts/<topic>/` directory: `lint-coverage-map*` 13 files, `backlog-lint*` 12,
  `suppression-ledger*` 10, `sensor-near-duplicates*` 9, `client-test-isolation*`
  6, `max-lines*` 6, `sensor-knip-unused-exports*` 6 — 62 files across seven
  families.
- `suppression-ledger*` is the newest and is nowhere on record: entrypoint
  `scripts/suppression-ledger.ts` (`package.json:84-85`, `lint:suppressions:ledger`
  and `:changed`), implementation modules `-core.ts`, `-runner.ts`, `-baseline.ts`,
  `-emission.ts`, `-identity.ts`, and four colocated tests. It is not in
  `scripts/README.md`'s sanctioned-exception paragraph (`:32-40`) or its directory
  table, and not in `scripts-flat-family-reorg.md`.
- `worktree-seed*` — 7 files, no `scripts/worktree-seed/` and no top-level
  `worktree-seed.ts` entrypoint: `-runtime-loader-exports.ts`,
  `-runtime-loader-identifiers.ts`, `-runtime-loader-validation.ts` are
  implementation modules of `worktree-seed-runtime-loaders.ts`, alongside
  `worktree-seed-import-closure.ts` and two tests. The consumer is
  `scripts/worktree-db.sh`, so this group needs a ruling of its own rather than
  being swept in with the seven above.
- Not violations, and not to be counted as such: `adr-check*` (4 — entrypoint,
  test, and two companions), `sensor-blob-size*` (2) and `sensor-context-budget*`
  (2), each an entrypoint plus its colocated test. All three sit inside the
  `scripts/README.md:27-30` companion allowance.
- `docs/agent_notes/backlog/scripts-flat-family-reorg.md:1` — Status: Parked, and
  already names three of these families plus the hollow `scripts/harness-audit/`.
- `scripts/harness/` — 14 files carrying a redundant `harness-` prefix (8
  non-test): `harness-audit-report.ts`, `harness-audit.test.ts`,
  `harness-check-validation.ts`/`.test.ts`,
  `harness-diagnostics-output.ts`/`.test.ts`, `harness-gate-parity.ts`,
  `harness-manifest.ts`/`.test.ts`, `harness-manifest-loader.ts`/`.test.ts`,
  `harness-manifest-schema.ts`/`.test.ts`, `harness-paths.ts`. Siblings such as
  `hook-shims.ts`, `skill-inventory-schema.ts`, `registration-check.ts`,
  `generate-*.ts` do not.
- `scripts/harness-audit/` — exactly 6 files, all under `fixtures/`; the
  implementation is `scripts/harness-audit.ts` and the test is
  `scripts/harness/harness-audit.test.ts`.
- `scripts/drift-ai/` — 344 `.ts` files, 57,180 lines, only `fixtures/` and
  `docs/` as subdirectories, no `MODULE.md`.
- `scripts/drift-ai/check-metadata.ts:1-6` — the two-registry layering law
  ("config/CLI-time code … imports ONLY this module, so listing checks or parsing
  config never loads the tool runners / graph builders") exists *only* as a
  comment in one file.
- `scripts/drift-ai/check-registry.ts:1-16` — the 16 runtime plugin imports that
  law separates from.
- `scripts/drift-ai/README.md` — 890 lines, 33 headings below the title, all
  user-facing behavior (quickstart, per-check semantics, config discovery); no
  layout, architecture, or layering section.
- `scripts/drift-triage/MODULE.md` — the asymmetric counter-example.

## Proposed direction

1. Decide the position and write it down first, before any file moves. Reopen
   `docs/agent_notes/backlog/scripts-flat-family-reorg.md` (it is Parked, not
   closed) and make it the single owner of the family question; this leaf's
   family half should be folded into that note rather than tracked twice. Extend
   its list from three families to every top-level group that violates the rule,
   re-derived from the tree at decision time rather than copied from this leaf —
   currently `lint-coverage-map`, `backlog-lint`, `suppression-ledger`,
   `sensor-near-duplicates`, `client-test-isolation`, `max-lines`, and
   `sensor-knip-unused-exports` — and record the decision for each: move, or
   sanctioned exception in `scripts/README.md`. Rule explicitly on `worktree-seed`
   and on `adr-check` in the same pass. Do not open a decision on
   `sensor-blob-size` or `sensor-context-budget`; record them in the step 2
   registry as companions of their own entrypoints. `sensor` is a `package.json`
   command namespace (`sensor:*`), not a family — if both `sensor-*` families
   move, they get two owner directories (`scripts/sensor-near-duplicates/`,
   `scripts/sensor-knip-unused-exports/`) and two commits under step 3. A single
   `scripts/sensor/` would repeat the first-`-`-segment grouping error step 2
   rejects.
2. Make the rule checkable — by **declared role, not by filename prefix**. A
   prefix-grouping check with a count threshold cannot express the contract:
   `scripts/README.md:11-30` classifies a top-level file by what invokes it
   (package.json command, `.husky/`/workflow/doctor surface, facade with a
   matching `scripts/<topic>/`, or direct companion of one entrypoint), and none
   of those roles is visible in the filename. Prefix grouping both over- and
   under-fires: grouping on the first `-` segment invents a 32-file "lint" family
   (25 non-test) out of a dozen independent entrypoints (`lint-changed.sh`,
   `lint-fix.sh`, `lint-import-cycles.sh`, `lint-agent*`, `lint-coverage-map-*`,
   `lint-message-eval.ts`, `lint-probe-rule.ts`) and a "check" family out of three
   unrelated commands (`check-eslint-react-peer-exception.sh`,
   `check-fast-uri-override.sh`, `check-local-eslint-rule-starter.ts`), while
   "group has a matching `scripts/<topic>/`" clears `harness-*` — which is exactly
   the split step 4 exists to fix — and clears any family the moment its directory
   is created, even if the implementation files stay flat.

   Build the check on the declarations that already exist instead: read the
   `package.json` script bodies, the `.husky/` hooks, `.github/workflows/`, and
   `scripts/doctor.sh` for the files they invoke; treat `scripts/<topic>.ts|.sh`
   with a sibling `scripts/<topic>/` as a facade; and require every *remaining*
   top-level file to be listed in an explicit registry declaring which entrypoint
   it is a companion of, or as a sanctioned exception. The check then fails on
   undeclared top-level files — a rule that means what the README means, that a
   new flat family cannot satisfy by accident, and that reviewers can read.
   `scripts/harness/` and `harness:check` are the natural home; the README's own
   sanctioned-exception paragraph (`scripts/README.md:32-40`) shows the format the
   registry should mirror. Expect the registry to start large — out of 162
   top-level files it has to absorb the 62 violating ones plus the companion sets
   around `adr-check`, `sensor-blob-size`, `sensor-context-budget`, and
   `worktree-seed` — and to shrink as families move; that is the point, the debt
   becomes enumerated instead of invisible. Without this step the rest of the work
   decays again.
3. Move one family per commit, in order of least coupling. Each slice updates
   imports, package scripts, harness controls, path-policy subjects, fixtures,
   and prose references together — do not batch two families into one commit.
4. Fold `scripts/harness-audit/fixtures/` next to the logic it feeds and delete
   the fixtures-only directory, or (if the split is deliberate) document it in the
   `scripts/README.md` directory table. Three locations for one tool is the thing
   to end; either resolution does that. Price the move before choosing it: the
   `scripts/harness-audit/fixtures/**` path is an exclusion glob in
   `eslint-config/shared-policy.js:74` and `tsconfig.scripts.json:20`, is asserted
   in `eslint-rules/shared-policy.test.js:106`,
   `scripts/lint-ratchet/baseline.test.ts:378`, and
   `scripts/lint-coverage-map-check-suggest.test.ts:298`, appears four times in
   `lint-ratchet.baseline.json`, and is enumerated in generated
   `docs/generated/lint-coverage-map.md:67,319,326`. Editing
   `eslint-config/shared-policy.js` changes a config surface and so triggers a
   full-scan lint, on top of regenerating the coverage map — which makes
   documenting the split the cheaper resolution.
5. Rename every `harness-`-prefixed file inside `scripts/harness/` to drop the
   redundant prefix, matching its 50 unprefixed siblings. Re-run
   `ls scripts/harness/ | grep '^harness-'` before starting — the set is 14 at
   `883d48bf` and has grown before. No de-prefixed name collides with an
   existing sibling. This is a mechanical rename plus import updates; keep it a
   single commit so it is trivially reviewable and revertable.
6. Add `scripts/drift-ai/MODULE.md` following `docs/guides/add-module-doc.md`,
   modelled on `scripts/drift-triage/MODULE.md`. It should name the prefix
   families that already organise the directory — `duplicate`, `hotspots`,
   `coldspots`, `knip`, `coverage`, `semgrep`, `ghost`, `env`, `dolos`,
   `test-orphaning`, `ownership`, `near`, `clone`, `birth-size-delta`,
   `class-construction` — and promote the layering law from the comment at
   `check-metadata.ts:1-6` into prose, leaving the comment in place. Write the
   families as names, **not** as file counts: the counts move under the tool's own
   development (currently duplicate 25, hotspots 21, coverage 20, knip 20,
   semgrep 18, coldspots 17, ghost 12, env 12, dolos 11, class-construction 10,
   test-orphaning 10, ownership 10, near 10, clone 9, birth-size-delta 9), and a
   MODULE.md that pins them is stale on arrival with nothing to catch the drift.

## Scope / caveats

- **Do not restructure `scripts/drift-ai/` into subdirectories.** The verified
  finding is a *navigation* gap, not a layout defect: the layering is already
  real and correct (`check-metadata.ts` vs `check-registry.ts`), and the prefix
  families already function as an index. The remedy is one `MODULE.md` — small
  effort, low risk. Moving 344 files would break the flat relative-import
  convention the two registries depend on and is not what this finding asks for.
- **Sized XL, and splittable.** Step 2 is a role-derived registry seeded with
  roughly seventy declarations; add the seven family moves (each touching
  imports, package scripts, harness controls, path-policy subjects, and
  fixtures), the `harness-` prefix rename, and the `MODULE.md`, and this is past
  L. Steps 1-3 (position, check, moves) are the epic; steps 4-6 are independently
  schedulable S/M items and can be lifted out if the family question stalls.
- **Do not enforce this with a filename-prefix count threshold.** It cannot
  distinguish the four roles `scripts/README.md:11-30` defines, so it would flag
  sanctioned entrypoint sets and clear genuine flat families; see step 2 for the
  concrete misfires (`lint-*`, `check-*`, `harness-*`). If step 2's role-derived
  registry turns out to be too much machinery, the honest fallback is to keep the
  rule as prose and drop the enforcement claim — not to ship a check whose
  verdicts do not match the contract it cites.
- **Every count in this leaf is a snapshot, not a contract.** Re-run the
  enumeration in step 1 against the tree before acting on it; with nothing
  enforcing the rule, the violating set grows faster than any list of it. Do not
  move
  `scripts/adr-check*`, `scripts/sensor-blob-size*`, or
  `scripts/sensor-context-budget*` without an explicit decision in step 1 — all
  three read as sanctioned companion sets.
- **This re-reports an open parked note.** `scripts-flat-family-reorg.md` already
  owns `lint-coverage-map`, `client-test-isolation`, `sensor-knip-unused-exports`,
  and the hollow `scripts/harness-audit/`. What is genuinely new here is
  `backlog-lint`, `max-lines`, `suppression-ledger`, `sensor-near-duplicates`
  (9 files, absent from the note), `worktree-seed`, and the enforcement gap — plus
  the growth of the families it does track: `sensor-knip-unused-exports` from the
  4 files it records at `:15` to 6, and `lint-coverage-map` from the 9 at `:13` to
  13. Merge rather than duplicate — a second live note on the same subject is
  exactly the kind of drift this pack is trying to reduce.
- The parked note records that the `drift-triage*` family already collapsed into
  `scripts/drift-triage/` behind a flat `scripts/drift-triage.ts` entry. Reuse
  that entry-plus-directory idiom; do not invent a new shape.
- Preserve the `scripts/drift-ai/check-metadata.ts:1-6` comment verbatim when
  adding the MODULE.md. It states an import-graph invariant TypeScript cannot
  express (config/CLI-time code must never transitively load tool runners), and
  the MODULE.md should reference it, not replace it.
- Steps 3, 4, and 5 move files that path-policy, ESLint/TypeScript scope config,
  and harness-controls enumerate; run `bun run harness:check` after each slice,
  and expect generated harness surfaces to need regeneration in the same commit.
- Sequencing: leaf 29 proposes a `scripts/worktree-db/` owner directory behind a
  `scripts/worktree-db.sh` facade — the same `scripts/README.md:11-45` contract
  this leaf is trying to make enforceable, and the consumer of the flat
  `worktree-seed*` group, so the two rulings have to agree. Land step 1 (the
  written position) and step 2 (the check, with its companion/exception registry)
  before 29's decomposition, so the new directory is created under a rule that
  exists rather than one that has to be retrofitted around it.
