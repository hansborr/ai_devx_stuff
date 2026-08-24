# 108. The repo's shared import-closure walker masquerades as three seed-private `worktree-seed-*` scripts, with its contract stated nowhere

Status: Landed on fix/cq-108
Theme: misnamed shared harness library · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

> Update 2026-08-13: the evidence below is pinned to a revision that no longer
> exists. The 2026-08-13 design review found the family over-built, and the
> commonjs-policy, environment-capability, and lockfile-subgraph modules it
> counts were deleted; the walker is now four modules whose policy is a coarse
> fail-closed token scan. The naming/ownership problem this leaf states
> (a shared import-closure walker named as if it were seed-private) is
> unchanged — the family is still `scripts/worktree-seed-*.ts` with four
> consumers.

## Problem

The three `scripts/worktree-seed-*.ts` production modules — 723 lines — read
like a seed-private approximation of TypeScript/Bun/Node module resolution:
hand-coded extension probing, a hand-kept `@musi/*` alias table, a static ESM
import collector, and an explicit CommonJS rejection policy. That reading is
what the name and flat `scripts/` top-level placement invite, and it is wrong.

First, the family is not seed-private. It is the repository's single shared
source-level import-closure walker, consumed by four domains: worktree DB
seeding (`worktree-db.sh`), the fixture copy-set checks in `path-policy/`, the
harness fixture-closure guard, and the lint-ratchet portable-copy-set
assertions. Every consumer imports a module whose name claims it belongs to one
of them.

Second, the former eight-module CommonJS source-flow evaluator has been deleted
after eight review rounds failed to converge. The live closure is ESM-only:
static import/export/dynamic-import syntax is traversed, while CommonJS loader
roots and ambiguous capability escapes reject with a migration remedy. That
policy is not documented anywhere a reader would look: there is no MODULE.md, no statement
of why the walker deliberately diverges from real package-exports resolution
(`@musi/*` → `packages/*/src`, never `dist/`), and no boundary against
`scripts/code-intel`, the repo's *other* code-intelligence surface, which
resolves real semantics and cannot do this job.

The cost to contributors is concrete: a reader who needs a closure walk either
rebuilds a fifth copy because nothing tells them this one is general, or
rebuilds a CommonJS evaluator because nothing states the ESM-only policy — and
the previous quality pack was already about to
re-home the family under `scripts/worktree-db/`, cementing the seed-private
misidentity for a library with three non-seed consumers. The one genuinely
growing exposure — a new workspace package silently missing from the hand-kept
alias table until worktree provisioning throws — has no test-time guard.

## Evidence

Scale and decomposition (all counts re-measured at the pin):

- 723 production lines across three flat top-level modules:
  `scripts/worktree-seed-import-closure.ts` (336),
  `scripts/worktree-seed-commonjs-policy.ts` (319), and
  `scripts/worktree-seed-runtime-loaders.ts` (68) — plus two tests,
  `worktree-seed-import-closure.test.ts` (254) and
  `worktree-seed-runtime-loaders.test.ts` (111).
- The genuine resolution approximation is roughly 100 lines:
  `scripts/worktree-seed-import-closure.ts:68-89` (`resolutionCandidates`
  hand-codes `.js`→`.ts`/`.tsx`, `.mjs`→`.mts`, `.cjs`→`.cts` and `index.*`
  probing over the eight fingerprintable extensions declared at `:42-51`) and
  `:94-108` (`localImportBase` hand-maps `@musi/shared` →
  `packages/shared/src` and `@musi/server` → `packages/server/src`, and throws
  `unsupported repository-local package import` for any other `@musi/*` at
  `:104-106`).
- The 319-line CommonJS policy rejects value-space `require`, `module.require`,
  `createRequire`, loader-capable `process.getBuiltinModule` uses,
  import-equals, and `.cjs`/`.cts`; unknown capability escapes reject rather
  than entering a source-flow evaluator. The 68-line collector follows only
  runtime ESM import/export and static dynamic-import specifiers. Containment is enforced fail-closed too:
  `worktree-seed-import-closure.ts:55-58` (`isWithin`) and `:127-137`
  (realpath escape and unsupported-extension throws).
- The seed fingerprint now derives its runtime copy set directly from the
  walker's emitted closure. `scripts/worktree-db.sh:96-100` retains three
  blanket-hashed roots for non-imported seed data, while
  `validate_seed_runtime_import_closure` passes `--allowed-root "."` and
  `--emit-closure-nul`; `write_seed_runtime_import_digests` hashes every emitted
  repository-local path. This replaced `SEED_SERVER_RUNTIME_INPUTS`, which had
  already fallen behind four live inputs under `packages/server/src/prisma/`
  and `packages/server/src/utils/string-order.ts` and made seed fingerprinting
  fail before provisioning. Bounded copy-set consumers still use the library's
  `allowedRoots`/`allowedFiles` result, and the CLI still fails with "seed import
  closure contains unlisted repository-local runtime input(s)"
  (`worktree-seed-import-closure.ts:275-278`).
  `scripts/path-policy/fixture-import-closure.ts:1-9` records why hand lists
  alone are distrusted: three under-closure incidents on 2026-07-19.
- Four consumer domains, so "seed-private" is false:
  `scripts/worktree-db.sh:434`;
  `scripts/path-policy/fixture-import-closure.ts:26`;
  `scripts/harness/fixture-closure-check.ts:121`;
  `scripts/lint-ratchet/output-emission.test.ts` (the `validateSeedImportClosure`
  import and its call site; unit 068 split the former
  `scripts/lint-ratchet/output.test.ts:19,87` pinned here at audit time, so
  resolve these two by symbol rather than by line) — plus
  `scripts/tests/test-lint-ratchet.sh:143-145`, which dynamic-imports the
  checker by literal path. The prior pack's CONSTRAINTS table records the
  lint-ratchet reuse as deliberate
  (`docs/agent_notes/backlog/code-quality-2026-07-25/CONSTRAINTS.md:48`), and
  the memo comment at `worktree-seed-import-closure.ts:170-180` notes the
  fixture copy-set checks walk 508 entry-files that are only 36 distinct
  modules — the non-seed consumers dominate.
- Real resolution cannot replace it: the walker must run inside synthetic
  sandbox roots whose `node_modules` contains only symlinks
  (`scripts/tests/test-harness-check.sh:154-159` links exactly `typescript`
  into the fixture), and `@musi/shared`'s package exports point at `dist/`
  while the fingerprint needs `src/`.
- The move's full reference surface, re-derived (the hand-maintained list is
  larger than previously recorded): the four code references above; the
  literal path in `test-lint-ratchet.sh:144`; the `# smoke-subjects:` headers
  at `scripts/tests/test-worktree-db.sh:4-8`,
  `scripts/tests/test-harness-check.sh:57-61`, and
  `scripts/tests/test-lint-ratchet.sh:53`; the intra-family spawned-checker path at `scripts/worktree-seed-runtime-loaders.test.ts:173`; the non-header path references at `scripts/worktree-db.sh:52`, `scripts/tests/test-worktree-db.sh:389,404`, and `scripts/tests/test-harness-check.sh:154`; and `harness.controls.json`, where
  three controls list all three production paths in `generatedSurface` facets
  (`check/verify-steps-generator` fixturePaths `:1558-1564`;
  `check/skill-artifacts-generator` and `check/smoke-subjects-generator`
  triggerPaths, e.g. `:1644-1648`). Generated surfaces that must be
  regenerated, never hand-edited:
  `scripts/path-policy/path-policy-smoke-subjects-data.ts` (`:105-109`),
  `scripts/harness/generated-surface-freshness.generated.sh` (`:57`, `:66`),
  `scripts/tests/harness-check-fixture-manifest.generated.txt` (`:99-103`),
  and `docs/generated/lint-coverage-map.md` (`:160`).
- The prior pack's still-open relocation points the wrong way:
  `docs/agent_notes/backlog/code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:131`
  (slice H12, Open) moves the family into `scripts/worktree-db/`, is blocked
  on unlanded 28-PLAN slice 28.1 (`:7`) and on H11 (`:177`), and discharges
  the disposition `28-PLAN.md:165` assigned to leaf 29. It is a file move
  only — it neither documents the contract nor fixes the seed-private naming.

## Proposed direction

Promote the misnamed shared library instead of rebuilding it. The residual
defect is misnaming, mishoming, and an undocumented contract — not a redundant
private compiler — so the effective execution size is S. Four parts, sliced and
sequenced in [`108-PLAN.md`](./108-PLAN.md):

1. **Supersede the prior pack's H12 first.** Amend
   `code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:131` so this leaf owns the
   move and the destination becomes `scripts/import-closure/`. Side benefit:
   the neutral destination does not require `scripts/worktree-db/` to exist,
   dissolving H12's dependency on unlanded 28-PLAN slice 28.1 and on H11.
2. **Move and rename.** Move the three production modules plus two tests into a
   new top-level `scripts/import-closure/` directory — peer of
   `scripts/path-policy/` and `scripts/drift-triage/`, the repo's
   MODULE.md-bearing multi-module precedents; NOT `scripts/lib/` (a flat
   no-MODULE.md utility zone) and NOT `scripts/worktree-db/` — renaming to
   drop the `worktree-seed-` prefix (e.g. `closure-walk.ts`,
   `runtime-imports.ts`, `commonjs-policy.ts`). Keep
   current consumer policy at call sites unchanged:
   the seed caller retains its derived repository-local closure via
   `--allowed-root "."` plus `SEED_BLANKET_HASHED_ROOTS`, while bounded fixture
   copy-set policy stays in its existing consumers. Only the
   `MUSI_SEED_IMPORT_CLOSURE_CHECKER` default path changes in `worktree-db.sh`.
   Hand-edit the hand-maintained reference surfaces enumerated in Evidence;
   regenerate the generated ones (`bun run test:scripts:subjects`,
   `bun run verify:steps`, `bun run docs:lint-coverage-map:generate`) and
   validate with `bun run harness:check`.
3. **Ship a MODULE.md whose contract paragraphs are the substantive
   deliverable** (per `docs/guides/add-module-doc.md`): source-level mapping
   that deliberately diverges from package-exports resolution (`@musi/*` →
   `packages/*/src`, never `dist/`); rootable at arbitrary `--root` in
   synthetic sandboxes with no populated `node_modules`; byte-deterministic
   for fingerprint enumeration; fail-closed on dynamic loader forms. Include
   an explicit boundary paragraph against `scripts/code-intel` (real
   semantics, exports→`dist`, needs `node_modules`: use it for
   symbol/dependents queries; use this walker for sandbox/fingerprint
   closures) and a statement of the ESM-only/CommonJS-rejection policy, citing the three 2026-07-19 incidents at
   `path-policy/fixture-import-closure.ts:1-9`.
4. **Add a parity test** pinning the hand-kept `@musi` alias table
   (`worktree-seed-import-closure.ts:94-108` today) to the workspace package
   list, so a new package fails at test time instead of mid-worktree
   provisioning (today's failure mode is the throw at `:104-106`). This
   bounds the entire genuine resolver-drift exposure to the roughly 100 approximated
   lines.

Acceptance criteria: the MODULE.md code-intel boundary paragraph and the alias
parity test must land with the move — a rename-only execution fails the leaf.

## Scope / caveats

Binding rulings (restate of the panel's constraint rulings; do not relitigate):

- **Do not reintroduce a hand-maintained seed runtime manifest.** The emitted
  repository-local closure is the seed fingerprint copy set; the removed
  manifest had already under-closed the live Prisma/string-order graph and made
  every seed fingerprint fail. The 2026-07-19 fixture incidents independently
  demonstrate why a hand list must not be the seed runtime source of truth.
- **Do not rebase the walker on `scripts/code-intel` or
  `ts.resolveModuleName`.** Real resolution honors package exports
  (`@musi/shared` → `dist/`) and requires populated `node_modules` — both
  wrong for source-level fingerprinting in synthetic sandbox roots. Document
  the boundary in the MODULE.md instead.
- **Do not restore the deleted CommonJS extraction/source-flow evaluator.** The
  approved ESM-only reduction replaced it with an explicit fail-closed policy;
  document that boundary instead of rebuilding syntax propagation.
- **Do not let prior-pack slice CQ25-63/H12 land the family into
  `scripts/worktree-db/`.** Supersede H12 via an amendment at
  `code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:131`; the move goes to
  `scripts/import-closure/`.
- **Do not home the family in `scripts/lib/`** — flat, single-file utility
  zone with no MODULE.md precedent. `scripts/import-closure/` as a peer of
  `path-policy/` and `drift-triage/` is the documented convention.
- **Do not execute at the original "replace a private resolver" scope.** The
  genuine approximation is roughly 100 lines; the work is rename/re-home + MODULE.md +
  alias parity test + prior-pack plan amendment (effective size S).
- **Do not accept a rename-only execution** — the MODULE.md contract/boundary
  paragraphs and the parity test are the deliverables that fix the
  discoverability complaint.
- **Do not hand-edit wholly generated reference surfaces**
  (`path-policy-smoke-subjects-data.ts`,
  `generated-surface-freshness.generated.sh`); regenerate them. The lint
  coverage map is one of them now: `docs/generated/lint-coverage-map.md` is
  rendered end to end from the typed manifest, so edit the entry in the
  matching `scripts/lint-coverage-map-manifest-<area>.ts` module and run
  `bun run docs:lint-coverage-map:generate`. Note one
  mechanics correction verified against the tree:
  `generated-surface-freshness.generated.sh` is an output of
  `check/verify-steps-generator`, so it regenerates via
  `bun run verify:steps` (checked by `bun run verify:steps:check`), not via
  `bun run test:scripts:subjects`; the smoke-subjects data regenerates via
  `bun run test:scripts:subjects` (checked by
  `bun run test:scripts:subjects:check`), and `bun run harness:check`
  validates the manifest against the tree.

Other scope notes:

- Out of scope: any behavior change to closure semantics, the derived seed
  copy-set policy, bounded fixture policy, fingerprint inputs, or the
  loader-soundness rules. Every gate must prove the move behavior-neutral.
- Sequencing: part 1 (H12 supersession) must land before the move so the two
  packs cannot both relocate the family. No ordering dependency on other
  leaves in this pack; [147-major-harness-implementation-directories.md](./147-major-harness-implementation-directories.md)
  covers orientation docs for other harness directories and is complementary —
  the new MODULE.md here should not be counted against or duplicated by that
  leaf's scope.
- Prior-pack refs: CQ25-63 (= HARNESS-CLUSTER-PLAN H12) covers only the file
  relocation, not the resolver identity, contract, or parity guard — the
  novelty of this leaf survives it, and this leaf supersedes it.
- Operational risk: deleting paths under `scripts/` is smoke-sensitive
  (`scripts/path-policy/path-policy.ts:283-289`), so the move commit triggers
  a full shell-smoke run — do the whole move in one commit so the cost is
  paid once. Regenerate `harness.controls.json`-adjacent surfaces atomically
  in the same commit or structural registration fails for everyone.
