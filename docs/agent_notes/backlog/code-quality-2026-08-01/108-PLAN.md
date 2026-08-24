# 108-PLAN. Promote the import-closure walker to `scripts/import-closure/`: sliced execution plan

Status: Planned — executes
[`108-worktree-seed-validation-implements-private.md`](./108-worktree-seed-validation-implements-private.md)
and **supersedes prior-pack slice CQ25-63/H12**
(`../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:131`)

Date: 2026-08-02 · Area: harness · Source leaf: 108 (XL header, effective S)

## Scope decision (definitive)

The `worktree-seed-*` family is the repository's shared source-level
import-closure walker with four consumer domains (worktree-db, path-policy,
harness, lint-ratchet). The defect is identity — seed-private name, flat
top-level home, no written contract — not architecture. Therefore: **move and
rename, document the contract, and pin the one hand-kept table with a parity
test. Do not rebuild anything.** The binding rulings in the leaf's
Scope / caveats apply to every slice: no hand-manifest reintroduction, no
code-intel/`ts.resolveModuleName` rebase, no restoration of the deleted
CommonJS source-flow evaluator, destination `scripts/import-closure/` (never
`scripts/worktree-db/` or `scripts/lib/`), and no rename-only execution. The
ESM-only reduction landed first: the residual family is six production
modules / 1,081 lines plus two focused tests, not the former nine-module family.

All four slices land on one branch in one land session; stopping after 108.2
is a failed execution of the leaf (panel acceptance criterion: the MODULE.md
boundary paragraph and the parity test land with the move).

Flags: **[G]** changes generated harness/subject/doc output.

## Slices

| # | Slice | Done when | Verify |
|---|---|---|---|
| 108.1 | **Supersede H12.** Amend `docs/agent_notes/backlog/code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:131` (the H12 row) to `Superseded by code-quality-2026-08-01 leaf 108`, pointing here, and update its dependency-edge entries (`:172-177`): H12 no longer depends on 28-PLAN slice 28.1 or on H11, because `scripts/import-closure/` does not require `scripts/worktree-db/` to exist. Leave H11 itself untouched. Docs only; per the FIXED-sha rule, reference this plan by path, never by a not-yet-existing commit SHA. | Prior pack can no longer schedule a `scripts/worktree-db/` move of this family; edges updated | `bun run backlog:lint`; `bun run format:check` |
| 108.2 **[G]** | **The move.** Create `scripts/import-closure/`; `git mv` + rename the six production modules and two tests (suggested names: `closure-walk.ts`, `runtime-imports.ts`, `commonjs-policy.ts`, `commonjs-classification.ts`, `commonjs-policy-error.ts`, and `local-bindings.ts`, with tests beside them), fixing intra-family relative imports and literal sibling paths. Hand-edit every hand-maintained reference surface: `scripts/worktree-db.sh` (read-set comment plus `MUSI_SEED_IMPORT_CLOSURE_CHECKER` default — paths only; leave `--allowed-root "."` and the blanket-root policy unchanged); `scripts/path-policy/fixture-import-closure.ts`; `scripts/harness/fixture-closure-check.ts`; `scripts/lint-ratchet/output-emission.test.ts` (the `validateSeedImportClosure` caller, moved there by unit 068's split of the former `output.test.ts`); the literal dynamic-import path in `scripts/tests/test-lint-ratchet.sh`; the checker-path fixture and expectation in `scripts/tests/test-worktree-db.sh`; the copied-walker comment in `scripts/tests/test-harness-check.sh`; the `# smoke-subjects:` headers in those three shell tests; and all six family paths in each of `harness.controls.json`'s `generatedSurface` facets for `check/verify-steps-generator`, `check/skill-artifacts-generator`, and `check/smoke-subjects-generator`. Then regenerate (never hand-edit generator-owned spans): `bun run test:scripts:subjects` (smoke-subjects data + fixture list), `bun run harness:skills:refresh`, `bun run verify:steps` (`generated-surface-freshness.generated.sh` et al.), and `bun run docs:lint-coverage-map:generate`. One commit — see risk 1. Zero behavior change. | Family lives under `scripts/import-closure/`; a repo-wide `worktree-seed` sweep matches only historical prose; generated outputs landed in the same commit | `bash scripts/tests/test-worktree-db.sh`; `bash scripts/tests/test-harness-check.sh`; `bash scripts/tests/test-lint-ratchet.sh`; `bun run test:scripts:file -- scripts/import-closure/closure-walk.test.ts scripts/import-closure/runtime-imports.test.ts`; `bun run test:scripts:subjects:check`; `bun run verify:steps:check`; `bun run docs:lint-coverage-map:check`; `bun run harness:check` |
| 108.3 | **The contract.** `scripts/import-closure/MODULE.md` per `docs/guides/add-module-doc.md`, modelled on `scripts/path-policy/MODULE.md` / `scripts/drift-triage/MODULE.md`. Required paragraphs, each substantive: (a) contract — source-level mapping deliberately diverging from package-exports resolution (`@musi/*` → `packages/*/src`, never `dist/`), rootable at arbitrary `--root` in synthetic sandboxes with no populated `node_modules`, byte-deterministic for fingerprint enumeration, and fail-closed on unresolved imports; (b) boundary vs `scripts/code-intel`; (c) the ESM-only policy — static ESM import/export/dynamic-import traversal is supported, while CommonJS loader roots and ambiguous capability escapes are rejected with a migration remedy; (d) the four-consumer inventory and call-site-policy rule. Add a `scripts/import-closure/` row to the `scripts/README.md` Current Directories table. | MODULE.md exists with all four paragraphs; index regenerated in the same commit | `bun run module:index`; `bun run module:index:check`; `bun run format:check` |
| 108.4 | **The parity guard.** New focused Vitest beside `closure-walk.ts` pinning the hand-kept `@musi` alias table (today `worktree-seed-import-closure.ts:94-108`) against the workspace package list (root `package.json` `workspaces`: `packages/*`, `tools/*`, `examples/lint-ratchet-demo`): every `@musi/*` workspace package is either mapped to its `packages/*/src` root or named on an explicit in-test exclusion list with a reason (`@musi/client` and `@musi/lint-ratchet` are deliberately unmapped today — the walker throws at `:104-106`). A new workspace package then fails at test time, not mid-worktree-provisioning. TDD: land the assertion red-green against a synthetic table copy first. Register the test normally (Vitest `*.test.ts` files need no smoke-subject registration). | Adding a fake workspace package makes exactly this test fail; no production change | `bun run test:scripts:file -- scripts/import-closure/alias-parity.test.ts`; `bun run harness:check` |

## Dependency edges

- `108.1 → 108.2` — the written supersession must precede the move so two live
  plans cannot both relocate the family.
- `108.2 → 108.3, 108.4` — the directory and final filenames must exist.
- `108.3` and `108.4` are independent of each other.
- No edges to other leaves in this pack. Leaf
  [`147`](./147-major-harness-implementation-directories.md) (orientation docs
  for harness directories) is complementary; if it is in flight, it should
  list `scripts/import-closure/` as covered by this plan rather than
  double-writing the MODULE.md.

## Operational risk

1. **The move commit triggers a full shell-smoke run.** Any deleted path under
   `scripts/` is smoke-sensitive (`scripts/path-policy/path-policy.ts:283-289`),
   and an unmapped deletion falls back to the full suite. Expected, not a
   failure — do the entire move (files + references + regenerated outputs) in
   one commit so it is paid once.
2. **Partial `harness.controls.json` or generated-output changes fail
   structural registration for everyone.** Regenerate and commit atomically
   within 108.2; `bun run harness:check` before committing.
3. **Rename churn is the main review hazard.** 108.2 must be byte-neutral in
   behavior: no edits to closure logic, derived seed policy, bounded fixture
   policy, or loader rules ride along. Reviewers diff the moved files with
   `git diff --find-renames`.
4. **The `MUSI_SEED_IMPORT_CLOSURE_CHECKER` env seam masks a wrong default.**
   `worktree-db.sh` dies with "missing … can't validate seed runtime imports"
   only when the default path is actually resolved, so 108.2's proof must
   include `bash scripts/tests/test-worktree-db.sh` (it exercises the seam),
   not just Vitest.
5. **Land mechanics.** Full sequential `verify` via `bash scripts/land.sh`
   exceeds the 10-minute foreground cap — run it in the background.

## Rejected alternatives + why

| Rejected | Why |
|---|---|
| Reintroduce an explicit hand-maintained seed runtime manifest | The removed manifest had already omitted four live runtime inputs and made seed fingerprinting fail before provisioning. The emitted repository-local closure is now the single seed runtime copy set; three separate under-closure incidents on 2026-07-19 (`fixture-import-closure.ts:1-9`) reinforce why hand lists are not its source of truth. |
| Rebase on `scripts/code-intel` / `ts.resolveModuleName` | Real resolution honors package exports (`@musi/shared` → `dist/`) and needs populated `node_modules`; the walker must map to `src/` and run in sandboxes whose `node_modules` is a lone `typescript` symlink. Semantically wrong, not just costly. |
| Restore the deleted CommonJS extraction/source-flow evaluator | Eight review rounds continued to alternate between silent misses and innocent-code rejections. The repository now uses static ESM in the seed closure and rejects CommonJS loader capabilities at the policy boundary instead. |
| Let prior-pack H12 land the family into `scripts/worktree-db/` | Re-encodes seed-private naming for a library with three non-seed consumers, and stays blocked on unlanded 28-PLAN slice 28.1. The neutral destination dissolves both. |
| Home the family in `scripts/lib/` | Flat single-file utility zone with no MODULE.md precedent; `path-policy/` and `drift-triage/` are the multi-module convention. |
| Rename-only execution | Leaves the discoverability complaint — the actual defect — unfixed. The MODULE.md boundary paragraph and the parity test are the deliverables. |
