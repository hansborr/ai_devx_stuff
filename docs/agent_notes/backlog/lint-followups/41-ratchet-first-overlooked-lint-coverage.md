# Leaf 41: Ratchet-First Overlooked Lint Coverage

Status: In progress - drafted/promoted 2026-05-20 by human request; reviewed
2026-05-20 after human clarification that new ratchets must remain in local
pre-commit enforcement and should cover every maintained code/tooling surface
before cleanup priority is considered. Refined after reviewer feedback to make
the coverage map a committed, derived artifact and to split non-ESLint floor
infrastructure into named child follow-ups when it is too large for the first
Leaf 41 batch. The durable coverage-map path is
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`.

**Phase 1 (coverage map) landed 2026-05-20 via merge `b3c0ca0c`** on
`feature/lint-hardening-review-followup`. Every tracked file family resolves to
one of `{linted, ratcheted, proposed, pending-leaf, excluded, not-code}`; no
`unknown` rows remain. Subsequent ratchet/floor batches use this map as their
frozen scope. The remaining Implementation Order steps (2–7) and Candidate Work
items below are the in-flight work.
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `docs/agent_notes/backlog/lint-followups/11-codemod-eslint-coverage.md`
- `docs/agent_notes/backlog/lint-followups/30-generate-harness-controls-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/31-code-intel-facade-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/32-drift-ai-under-ceiling-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/33-drift-ai-report-family-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/34-drift-ai-inventory-family-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/35-codemod-test-harness-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/36-codemod-concurrency-and-logging-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/37-codemod-barrel-and-trpc-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/39-ratchet-runtime-script-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/40-logs-audit-and-drift-entrypoint-lint-adoption.md`
- `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`
- `scripts/lint-ratchet-config.ts`
- `docs/guides/lint-ratchet.md`

## Problem

Several script and codemod families grew outside the main ESLint config because
they were not included when first developed. The cleanup leaves 30-40 were
initially drafted as "fix first, then lint" work, but that repeats the original
failure mode: large existing debt blocks any enforcement, so the overlooked
area can keep growing while waiting for a full cleanup.

The ratchet system exists to avoid that. The next enforcement step should add
baseline-backed lint ratchets or equivalent local floors for all maintained
code/tooling surfaces first, then drain findings incrementally. A floor blocks
new or worsening debt while cleanup waits its turn; it does not require the team
to clean that area immediately.

External CI is not currently reliable enough to be the only enforcement point,
so new ratchets stay in `bun run lint:ratchet`, `bun run verify:changed`, and
pre-commit even if runtime grows. Runtime measurements should guide batching or
parallelization, not a CI-only posture.

## Scope

Audit tracked maintained code-like and tooling files that are outside normal
`bun run lint` coverage or only partially covered, then add ratchets/floors for
every reasonable high-signal rule already applicable to those areas.
"Reasonable" means the rule catches a bug class, maintainability boundary, or
future cleanup invariant that should not get worse while the baseline drains.
Pure formatting or stylistic churn should be left to autofix/normal-lint
adoption unless it is already blocking a concrete adoption slice.

The first priority is coverage, not cleanup. It is acceptable for a floor to
land without an immediate drain plan when the area is low-priority to clean, as
long as new/worse findings are blocked locally and the baseline is documented.

Start with the known script/codemod gaps from Leaves 30-40:

- `scripts/generate-harness-controls.ts`
- `scripts/code-intel.ts`
- `scripts/drift-ai/**/*.ts`
- `scripts/codemods/**/*.ts`, excluding `scripts/codemods/fixtures/**`
- top-level TypeScript scripts outside `tsconfig.scripts.json`
- ratchet runtime and harness scripts
- large script entrypoints/tests such as `logs-audit.ts`, `drift-ai.ts`,
  `drift-ai.test.ts`, and `code-intel.test.ts`
- known named stragglers: `scripts/sensor-blob-size.ts` and
  `scripts/codemods/lib/trpc-shared-schema.ts`

Then explicitly check these non-package tooling surfaces, which are easy for
agents to overlook because they are not ordinary package source:

- local ESLint rules and tests under `eslint-rules/**/*.js`
- shell scripts and hooks:
  `scripts/**/*.sh`, `.husky/*`, `.codex/hooks/*.sh`, `.claude/hooks/*.sh`,
  and `.devcontainer/*.sh`
- root and package config files currently ignored by `**/*.config.*`, including
  `eslint.config.js`, `commitlint.config.js`, `knip.config.ts`,
  `playwright.config.ts`, `stryker.config.mjs`, `vitest*.config.ts`,
  package `vite.config.ts` / `vitest.config.ts`, and Prisma config files
- workflow, agent, and devcontainer configuration such as
  `.github/workflows/*`, `.codex/*`, `.claude/*`, and `.devcontainer/*`
- package/workspace manifests and lock/config JSON/TOML/YAML files that affect
  automation

Exclude generated artifacts, fixture snapshots, archived/reference material, and
vendored/dependency output unless a human says that surface is maintained live
code. Examples that should stay out by default: `docs/refs/**`, `worktrees/**`,
`scripts/codemods/fixtures/**`, generated docs, `dist`, and `node_modules`.

## Ratchet-First Rule

For every promoted ratchet-first/drain leaf in this family, the first
enforcement commit should be ratchet coverage, not refactoring:

1. Inventory the candidate files against the relevant lint rules.
2. Add or extend `lint:ratchet` entries with scoped `files` / `ignores` and the
   current finding counts committed in `lint-ratchet.baseline.json`.
3. Ensure `bun run lint:ratchet` fails on new findings or higher per-file
   counts.
4. Only then begin cleanup, splitting, normal `bun run lint` adoption, or
   baseline drains. Cleanup is optional for the initial coverage sweep; do not
   skip a floor because nobody plans to clean that area right away.

If the current ratchet runner cannot express a reasonable rule source (for
example core ESLint rules such as `complexity` / `max-params`, or a
third-party plugin that is not allowlisted), extend the ratchet infrastructure
as the first Leaf 41 phase. Do not defer enforcement solely because the current
finding count is large.

Current known ratchet support constraints:

- `local/*` rules are supported today with the `minimal-ts` parser profile.
- `@typescript-eslint/*` rules are supported today through the existing
  third-party allowlist for the `typescript-eslint` package.
- Other third-party namespaces need allowlist entries before ratcheting, for
  example `regexp`, `simple-import-sort`, and `vitest`.
- Core ESLint rules such as `complexity`, `max-params`, and
  `no-nested-ternary` are not supported today. Add a `source: { kind: "core" }`
  model, bare-rule-id validation, ESLint-version source hashing, generated
  config support, and smoke/unit coverage before using those ratchets.
- Non-ESLint surfaces such as shell, YAML, TOML, and GitHub Actions may need
  either a new ratchet source kind or a separate local sensor with the same
  baseline-and-no-regressions contract. Treat each tool family as its own small
  infrastructure project when needed: ShellCheck for maintained shell/hooks,
  actionlint for workflows, and yamllint/taplo/jsonschema or equivalent
  validation for config files may become Leaf 41b/41c-style child leaves. The
  parent Leaf 41 coverage map must still record them as known surfaces with a
  proposed floor or named follow-up, not leave them as unknown.

## Implementation Order

1. Commit the repo-wide coverage map artifact at
   `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` before
   choosing cleanup work or adding ratchet batches. Derive it from
   `git ls-files`, then match tracked files against `eslint.config.js`
   ignore/unignore/parser blocks and the current
   `scripts/lint-ratchet-config.ts` scopes rather than relying on memory. A
   Markdown table is fine if it is easy to re-derive; a checked-in script output
   is better if the implementation adds a generator. Include at least:
   path/group, file count or representative globs, normal lint status, existing
   ratchet/floor status, parser/tool, proposed rule/tool, status, and
   blocker/follow-up. Use `unknown` only as a temporary mapping bucket and drive
   it to zero before ratchet/floor implementation batches begin. Do not count
   existing `ratchet/local-type-assertion-boundary` coverage as sufficient for a
   family unless type assertions are the meaningful rule for that family; the
   point of Leaf 41 is to add missing guardrails such as max-lines, complexity,
   import-sort, regexp, test-quality, shell, config, or workflow rules where
   they are the real risk.
2. Identify parser/project blockers before promising ratchet entries. For
   top-level standalone scripts such as Leaf 38, the first implementation step
   may be a small `tsconfig.scripts.json` or parser-profile decision so the
   files are visible to the ratchet runner at all.
3. If selected rules include core ESLint rules, add core rule-source support to
   the ratchet runner first, with config/baseline hashing and smoke/unit tests.
4. Add narrow ratchet/floor entries, manifest rows, generated harness docs, and
   baseline counts in small batches, usually 2-3 coherent ratchets or one
   parser/source-kind family at a time. The first batches should prefer missing
   coverage breadth over cleanup payoff. If a non-ESLint floor needs a new tool
   integration or baseline sensor, split that tool family into a named child
   leaf while keeping the parent coverage-map row linked to the follow-up.
5. Prefer one coherent ratchet per rule/file family over overlapping sibling
   ratchets. For `scripts/drift-ai/**`, check whether a single rule-specific
   ratchet over a precise file set is simpler than separate under-ceiling,
   report-family, and inventory-family ratchets. If separate ratchets are used,
   make the file sets disjoint for the same rule.
6. Prove each new scope actually matches the intended files. For a zero-finding
   baseline, temporarily introduce a tiny violation in an in-scope file, confirm
   `bun run lint:ratchet` reports it, then revert the probe before committing.
   Record the probe in the leaf summary or finished-work note.
7. Re-measure `bun run lint:ratchet` after each small batch. If runtime is
   painful, promote the runner improvement from Leaf 04's runtime notes
   (parallelize first, then consider batching by parser profile); do not remove
   the local/pre-commit gate.

## Phase 2 Batch Order (post-coverage-map)

Batches 1-3 added per-family `local/max-lines` ratchets for codemods, drift-ai,
and ratchet/harness runtime. The coverage map carries the landed scope. The
next batches are named in order; deviating requires a short durable note.

- **Batch 4: Vitest allowlist + codemod test-harness bug-class ratchet.** Add
  `vitest` (or `eslint-plugin-vitest`) to `lintRatchetThirdPartyPluginAllowlist`,
  then add a ratchet over codemod test files for `vitest/expect-expect`,
  `vitest/valid-expect`, `@typescript-eslint/only-throw-error`, and
  `@typescript-eslint/no-misused-promises` — the bug-class set called out with
  fix-soon urgency in §Candidate Work bullet 4 below. Exit path: drain to zero
  in Leaf 35.
- **Batch 5: Core-rule source support in the ratchet runner.** Adds
  `source: { kind: "core" }` (registry typing, bare-rule-id validation,
  ESLint-package-version source hashing, generated-config support, smoke + unit
  coverage). Pure infrastructure — no new ratchets land here. Unblocks any future
  `complexity`/`max-params`/`no-nested-ternary` ratchet.
- **Batch 6: First `complexity` ratchet over a high-signal script family**
  (codemods or drift-ai, whichever has the higher current count). Uses Batch 5
  infra. Exit path: drain in the relevant seed leaf (36/37 or 32/33/34).
- **Child leaf 41d: Coverage-map generator/check.** Separate effort: a
  pre-commit-runnable script that re-derives the map from `git ls-files` +
  `eslint.config.js` + `scripts/lint-ratchet-config.ts` and fails on drift. Not
  blocking on Batches 4-6.

Opportunistic follow-ons after the named batches (no scheduled order):

- Remaining per-family `local/max-lines` singletons: `logs-audit.ts` (Leaf 40),
  `code-intel.ts` (Leaf 31), `generate-harness-controls.ts` (Leaf 30). One batch
  with three sibling entries, or rolled into Batch 6 if the same family is
  picked.
- Drift-ai test-harness bug-class ratchets (Leaves 33/34 test rows) once the
  Batch 4 vitest allowlist is in place.
- Leaf 38 parser-project decisions for `db-status.ts`, `harness-emit-envelope.ts`,
  `sensor-blob-size.ts` (+ test), then a ratchet for that family.
- Root/package `*.config.{ts,mts,cts}` block with its own parser project.
- **Landed child leaf 41b: ShellCheck floor.** `scripts/lint-shell.sh` now
  resolves system `shellcheck` on `PATH` (`apt install shellcheck`) after the
  Leaf 41d follow-up, and full/changed lint cover `scripts/**/*.sh`,
  `.husky/*`, `.codex/hooks/*.sh`, `.claude/hooks/*.sh`, and
  `.devcontainer/*.sh`.
- Remaining Non-ESLint child leaf: 41c (actionlint + yamllint/taplo/hadolint
  over workflows, agent/devcontainer config, Dockerfiles).

Standing rules: keep new ratchets in the local/pre-commit gate (external CI is
not reliable enough to be the sole enforcement point). Land in small measured
batches, re-measure `bun run lint:ratchet` after each, and improve the
runner/sensor rather than skipping a local floor. Each new ratchet's
finished-work note must state an explicit exit path (drain to zero by leaf X,
or stays staged because Y) so floors do not become indefinite parking.

## Candidate Work

- Build and commit a fresh coverage map artifact at
  `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`: tracked
  maintained files vs normal lint coverage vs existing `lint:ratchet` coverage
  vs planned floor vs explicitly excluded. Derive the map from `git ls-files`
  plus the actual ESLint ignore/unignore/parser config and ratchet registry. The
  map must make every unknown visible and then resolve unknowns to normal lint,
  existing floor, proposed floor, intentional exclusion, or named
  blocker/follow-up before implementation batches proceed.
- Identify reasonable ratcheted rules for each overlooked family. Likely
  candidates include `local/max-lines`, `local/type-assertion-boundary`,
  `@typescript-eslint/consistent-type-imports`, explicit return types,
  `regexp/*` correctness rules, `simple-import-sort/imports`, `complexity`,
  `max-params`, `no-nested-ternary`, and Vitest test-quality rules where
  applicable.
- Add floor candidates for non-TypeScript tooling surfaces, splitting them into
  named child leaves when tool setup is more than a narrow same-cycle change:
  - `eslint-rules/**/*.js`: normal ESLint coverage or ratchets for local-rule
    implementation/test quality.
  - Shell and hooks: ShellCheck floor landed in child Leaf 41b.
  - Config files: ESLint or a comparable config-file lint floor for root and
    package `*.config.*` files.
  - Workflow/agent/devcontainer config: actionlint/yaml/json/toml validation or
    local structural sensors with committed baselines.
- Add ratchet runner support for core ESLint rules and any needed third-party
  plugin allowlist entries before adding cleanup-only work. Add separate
  sensor/floor support for non-ESLint tools when they are the right guard, but
  split ShellCheck/actionlint/yamllint/taplo/jsonschema-style integrations into
  named child leaves when that keeps the first implementation pass reviewable.
  Infrastructure belongs in Leaf 41 or a named child leaf when it is needed to
  make coverage broad.
- Add ratchet registry entries with narrow scopes and deterministic baseline
  counts. Prefer family-level scopes when the rule is coherent; split by file
  or feature family when runtime or diagnostic volume would be too noisy.
  For script/test `local/max-lines` debt, prefer separate script-family ratchet
  IDs over broadening the existing package/default `ratchet/local-max-lines`
  scope; the default ratchet intentionally excludes tests and most scripts.
- Classify ratcheted findings by urgency. Bug-class rules such as
  `vitest/expect-expect`, `@typescript-eslint/only-throw-error`, regexp
  correctness rules, and ambiguous truthiness rules should get a near-term drain
  plan, not an open-ended "eventually" bucket.
- Update `harness.controls.json`, generated harness docs, and
  `docs/guides/lint-ratchet.md` for any new ratchet entries or source kinds.
- Ensure `docs/guides/lint-ratchet.md` documents the two adoption workflows
  agents and contributors should follow: adding ratchets before bringing an
  unlinted area into normal ESLint coverage, and adding a new lint rule to an
  already linted area with a ratchet-backed staged rollout.
- Refresh Leaves 30-40 with the ratchet IDs that cover their files.
- Refresh Leaf 38 to include `scripts/sensor-blob-size.ts` with its test, and
  Leaf 37 to include `scripts/codemods/lib/trpc-shared-schema.ts`.

## Exit Criteria

- Every tracked maintained code/tooling surface is either under normal strict
  lint, under a local ratchet/floor, or explicitly excluded with a durable
  rationale. Existing broad type-assertion coverage alone is not enough unless
  the fresh inventory shows type assertions are the relevant risk for that
  family.
- `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` is the
  committed coverage-map artifact, derived from `git ls-files` and checked
  against the actual ESLint/ratchet scopes, with zero remaining `unknown` rows.
  Any surface not floored in the parent Leaf 41 pass points to an intentional
  exclusion or named blocker/follow-up.
- New findings in those scopes fail `bun run lint:ratchet` even if existing
  findings remain in the baseline, or fail an equivalent local floor command for
  non-ESLint surfaces.
- Each new or changed ratchet has matched-file proof; zero-finding ratchets have
  a recorded temporary-violation probe that was reverted before landing.
- The ratchet guide gives enough process detail for contributors in this repo,
  and for readers adapting the pattern to another project, to understand both
  unlinted-area adoption and new-rule rollout.
- No broad normal-ESLint unignore is required before ratchet coverage exists.
- New ratchets remain in local/pre-commit verification. Any runtime concern is
  addressed by runner improvements or follow-up runtime notes, not by relying on
  external CI.
- Leaves 30-40 remain as drain/adoption work after the ratchet floor is in
  place. New floor-only surfaces may defer cleanup, but not enforcement.
- Non-ESLint tool families that are not implemented in the first Leaf 41 pass
  are captured as named child leaves with their intended local tool and
  baseline/no-regressions contract.
- Bug-class ratchets added during Leaf 41 identify their urgency class; immediate
  cleanup is encouraged but not required before the floor lands.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- Temporary-violation probe for any zero-finding or newly parseable ratchet
  scope, reverted before commit.
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`
- `bun run verify:changed`
