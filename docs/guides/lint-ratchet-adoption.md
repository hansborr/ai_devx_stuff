# Lint Ratchet Adoption

This guide is for projects outside this repository that want to copy and adapt
the lint ratchet. It presents two adoption tiers, lists exactly what to copy for
each, and names the ongoing ownership cost.

For the full reference — commands, metrics, baseline identity, parser profiles,
zero-baseline lifecycle, CI parity, and coverage map — see
[Lint Ratchet](lint-ratchet.md).

## How the ratchet works

The ratchet has three pieces:

1. A **registry** of scoped rules. Each entry names the ESLint rule, source
   kind, parser profile, file globs, ignore globs, options, mode, metric, and
   repair kind.
2. A **committed per-file baseline**. `lint-ratchet.baseline.json` records each
   ratcheted file's current count or metric payload, plus config and rule-source
   hashes.
3. A **symmetric gate** that fails on both sides of drift. Regressions fail
   because current findings are above the committed floor; un-reflected
   improvements also fail because current findings are below the baseline and
   must be locked in with `lint:ratchet:update`.

The gate is the key property: debt cannot grow silently, and cleanup cannot go
unacknowledged.

## Tier 1 — Minimal ratchet

The minimal tier gives you the gate, baseline, and registry. No agent envelope,
no coverage map, no post-edit hooks, no CI reporting. The runner still emits a
`HarnessDiagnostics` JSON envelope for machine-readable failures; "no agent
envelope" means you are not adopting the separate changed-file
`lint:agent:local-rules` pipeline.

### What to copy

Runtime files (all paths relative to repo root):

| File | Role |
| --- | --- |
| `scripts/lint-ratchet.ts` | CLI entry point and re-exports |
| `scripts/lint-ratchet/` (entire directory) | Runner internals: ESLint config generation, collection, comparison, modes, CLI parsing, diagnostics, registry validation, baseline hashing, caching, glob helpers |
| `scripts/lint-ratchet/lint-ratchet-baseline.ts` | Baseline model, hashing, strict parse/format, update safety |
| `scripts/lint-ratchet/lint-ratchet-baseline-compare.ts` | Comparator: current findings vs committed baseline |
| `scripts/lint-ratchet/lint-ratchet-baseline-parse.ts` | Structural and strict parser for the baseline JSON |
| `scripts/lint-ratchet/lint-ratchet-check-registry.ts` | Fast preflight validator (no ESLint run) |
| `scripts/lint-ratchet/lint-ratchet-config.ts` | Registry types, third-party plugin allowlist, and the `lintRatchets` array you edit |
| `scripts/lint-ratchet/lint-ratchet-metrics.ts` | Metric helpers for `message-count`, `effective-line-count`, `complexity-severity` |
| `scripts/lint-ratchet/lint-ratchet-output.ts` | Harness diagnostics envelope output to stdout and optional file |
| `scripts/lint-ratchet/lint-ratchet-report.ts` | Markdown report formatter for CI step summaries and PR comments |
| `scripts/lint-ratchet/lint-ratchet-debt-log.ts` | Read-only renderer for the committed `lint-ratchet.debt-log.jsonl` acceptance log (the runner imports it to dispatch `--debt-log`) |
| `scripts/lint-ratchet/lint-ratchet-summary.ts` | Baseline summary table printer (no ESLint run) |
| `scripts/lint-ratchet/lint-ratchet-zero-baseline.ts` | Zero-baseline lifecycle audit and gate |
| `scripts/lib/lint-rule-docs.ts` | Local-rule metadata loader; replace with a same-export stub if you only ratchet core or third-party rules |
| `packages/shared/src/schemas/harness-diagnostics.ts` | Zod schema for the diagnostics envelope; copy at this path or move it and update the imports in the ratchet output, diagnostics, report, and copied tests |
| `lint-ratchet.baseline.json` | Start with `{ "version": 1, "tests": {} }` |

The full in-repo smoke copy list is the `PORTABLE_RUNTIME_FILES` array in
`scripts/tests/test-lint-ratchet.sh`. The narrower `runtimeFiles` array in
`scripts/lint-ratchet/lint-ratchet-output.test.ts` drives a portable smoke that writes its own
small fixture registry, so it intentionally omits the repository registry/config
files while still exercising the copied CLI runtime.

### Runtime assumptions

The copied runner is portable, but not package-manager neutral internals. It
currently assumes:

- a Git repository, because registry preflight, zero-baseline checks, and the
  coverage-map companion use `git ls-files`;
- intended ratchet files are tracked before you rely on empty-glob or lifecycle
  checks;
- a classic `node_modules` layout, because ESLint is spawned from
  `node_modules/.bin/eslint`, plugin and ESLint versions are read from
  `node_modules/<package>/package.json`, and generated configs/caches live under
  `node_modules/.cache/eslint-ratchet/`;
- generated isolated ESLint configs, not the project's normal flat config with
  one extra rule enabled. Rules that need project `settings`, globals,
  processors, import resolvers, or custom TypeScript project setup need
  `scripts/lint-ratchet/eslint-config.ts` changes;
- simple relative glob patterns shared by ESLint and the registry preflight
  matcher. If you need advanced minimatch features, extend
  `scripts/lint-ratchet/ratchet-globs.ts`.

Yarn PnP, global ESLint installs, non-Git source trees, and unusual cache roots
are supportable, but they require adapter changes rather than only package
script changes.

### What to change

1. **Replace the registry.** Remove the Musi-specific imports from
   `scripts/lint-ratchet/lint-ratchet-config.ts` (`maxLinesPolicy` and registry builders),
   clear `lintRatchets`, keep the exported types, and add one entry:

   ```ts
   export const lintRatchets = [
     {
       id: "ratchet/core-no-console-src",
       ruleId: "no-console",
       source: { kind: "core" },
       parserProfile: "minimal-ts",
       files: ["src/**/*.ts", "src/**/*.tsx"],
       ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/generated/**"],
       ruleOptions: [{ allow: ["warn", "error"] }],
       mode: "no-new",
       target: 0,
       metric: "message-count",
       repairKind: "manual",
     },
   ] as const satisfies readonly LintRatchetConfig[];
   ```

2. **Clear the third-party allowlist** unless you are ratcheting third-party
   plugin rules from the start.

3. **Delete or stub `scripts/lint-ratchet/lint-ratchet-registry-builders.ts`** after the
   registry no longer imports it. The builder functions are convenience
   abstractions over raw registry entries and are not required.

4. **Stub `scripts/lib/lint-rule-docs.ts` if you are not adopting local rules.** The
   CLI modes still import the loader so `local/*` ratchets can be validated. A
   core-only or third-party-only setup can keep a same-export stub that returns
   no entries:

   ```ts
   export interface RuleDocsEntry {
     readonly id: string;
     readonly principle: string;
     readonly pairedGuide: string;
     readonly repairKind: "autofix" | "codemod" | "manual" | "suggestion";
     readonly repairCommand?: string;
   }

   export interface RuleDocsFailure {
     readonly id: string;
     readonly failures: readonly string[];
   }

   export function formatRuleDocsFailures(failures: readonly RuleDocsFailure[]): string {
     return failures.map((failure) => `${failure.id}: ${failure.failures.join("; ")}`).join("\n");
   }

   export async function loadLintRuleDocs(_repoRoot: string): Promise<{
     readonly entries: readonly RuleDocsEntry[];
     readonly failures: readonly RuleDocsFailure[];
   }> {
     return { entries: [], failures: [] };
   }
   ```

5. **Update the `harness-diagnostics.ts` import path** if you move the schema
   file. The current runtime imports it from `lint-ratchet-output.ts`,
   `lint-ratchet/diagnostics.ts`, `lint-ratchet-report.ts`, and the portable
   tests. If you do not need the structured envelope at all, replace the schema
   and summary helper with a project-local equivalent before dropping Zod.

6. **Add package scripts:**

   ```json
   {
     "lint:ratchet": "bun scripts/lint-ratchet.ts",
     "lint:ratchet:check-registry": "bun scripts/lint-ratchet.ts --check-registry",
     "lint:ratchet:report": "bun scripts/lint-ratchet.ts --report",
     "lint:ratchet:summary": "bun scripts/lint-ratchet.ts --summary",
     "lint:ratchet:update": "bun scripts/lint-ratchet.ts --update",
     "lint:ratchet:zero-baseline": "bun scripts/lint-ratchet.ts --zero-baseline"
   }
   ```

   Swap `bun` for `npx tsx`, `pnpm exec tsx`, or your runner of choice only
   after the runtime assumptions above still hold.

7. **Run the adoption sequence.** Use a Git worktree with the intended files
   tracked:

   ```sh
   bun run lint:ratchet:check-registry   # prove the registry is valid
   bun run lint:ratchet:update           # generate the initial baseline
   bun run lint:ratchet                  # prove the gate passes
   ```

### What to copy for tests

The minimum portable test set:

- `scripts/lint-ratchet/lint-ratchet-baseline.test.ts` — baseline building, parsing,
  comparison, update decisions, diagnostics formatting, hashing, and registry
  validation with fixture data.
- `scripts/lint-ratchet/lint-ratchet-summary.test.ts` — summary reduction and table
  formatting with fixture baselines.
- `scripts/lint-ratchet/lint-ratchet-output.test.ts` — copies runtime files into a temporary
  repo, writes a small core-rule registry, runs the CLI, and verifies
  `HARNESS_DIAGNOSTICS_OUTPUT` behavior without project app state. Keep its
  `runtimeFiles` list synchronized with your actual runtime files.
- `scripts/lint-ratchet/lint-ratchet-check-registry.test.ts` — the portable cases test
  synthetic failure modes (empty globs, absolute paths, orphan baselines,
  deterministic ordering, absent-baseline). Replace the Musi-specific
  `accepts the Musi registry fixture` case with an equivalent smoke test for
  your own registry.

### What you own afterward

- **Baseline maintenance.** Renames move baseline keys; improvements require
  `lint:ratchet:update`. Both are mechanical but must happen in the same commit
  or PR as the source change.
- **Zero-baseline decisions.** When a ratchet reaches zero findings, you decide
  whether to promote the rule into normal ESLint, keep the ratchet with a
  documented disposition, or narrow the scope. The
  `lint:ratchet:zero-baseline` gate enforces this.
- **Registry coherence.** Adding, removing, or changing a ratchet entry requires
  `lint:ratchet:update` to refresh the baseline. The `check-registry` preflight
  catches structural problems before an ESLint run.
- **Dependency updates.** ESLint, typescript-eslint, and any allowlisted plugin
  upgrades change `ruleSourceHash` in the baseline. The gate fails until you
  re-baseline, so upgrades are explicit.
- **Portable test upkeep.** Keep the `runtimeFiles` list in the output test
  synchronized with the actual file set.

## Tier 2 — Full platform

The full tier adds the coverage map, agent envelope, post-edit hooks, CI
reporting, and custom guidance pipeline on top of Tier 1.

### Additional pieces

| Surface | Key files | What it does |
| --- | --- | --- |
| Coverage map | `scripts/lint-coverage-map-check.ts`, `scripts/lint-coverage-map-check-eslint-reach.ts` | Proves every tracked maintained file is accounted for by a lint owner (normal lint, ratchet, exclusion, or named blocker). Catches stale map rows, unknown ratchet ids, and ESLint reach gaps. |
| Agent envelope | `scripts/lint-agent.ts`, `scripts/lint-agent-changed.sh`, `packages/shared/src/schemas/harness-diagnostics.ts` | Emits structured `HarnessDiagnostics` JSON for `local/*` findings and parser errors, scoped to changed files. Agents and hooks consume this instead of raw ESLint output. |
| Custom guidance | `scripts/lib/lint-rule-docs.ts`, `scripts/generate-lint-guidance.ts`, `docs/generated/local-lint-rules.md` | Validates and publishes `meta.docs` metadata from local rules: description, principle, category, paired guide, repair kind. |
| Post-edit hooks | `scripts/ai-hooks/tidy-edited-file.sh`, `scripts/ai-hooks/common.sh`, `.claude/hooks/`, `.codex/hooks/` | Runs Prettier + `eslint --fix` on files an agent just edited. Non-blocking, bounded, skips unsafe paths. |
| CI report | `lint:ratchet:report` command, CI workflow steps | Renders the diagnostics envelope as a GitHub step summary and sticky PR comment with recovery instructions. |

### Additional ownership cost

Everything in Tier 1, plus:

- **Coverage map maintenance.** When you add files, directories, or ratchets,
  update the map and run the map gate. The map is a committed Markdown table;
  the checker validates it structurally.
- **Local rule metadata.** Each `local/*` rule needs `meta.docs` with
  `description`, `principle`, `category`, `pairedGuide`, and `repairKind`. The
  guidance generator and agent envelope depend on this vocabulary.
- **Hook compatibility.** The post-edit hook runs per-file Prettier and ESLint.
  Formatter or import-sort ownership changes (e.g., moving to Biome) require
  hook updates.
- **CI workflow wiring.** The sticky PR comment, step summary, and artifact
  upload need workflow maintenance when you change action versions, repository
  permissions, or the diagnostics envelope shape.

## What is not portable

These pieces are intentionally Musi-specific and should not be copied verbatim:

- The `lintRatchets` array contents (40+ entries with Musi paths, dispositions,
  and builder-function indirection).
- The `local/max-lines` ratchet wiring and its `maxLinesPolicy` shared-config
  dependency (tied to Musi's `local/max-lines` rule and shared config policy).
- The `harness.controls.json` manifest and `missing-harness-ratchet` check
  (Musi's harness control inventory).
- The Biome adoption guide (`biome-lint-adoption.md`) — reference material for
  a future Biome adapter, not a current adoption path.
- Path-policy scripts (`scripts/path-policy/path-policy.ts`) and ESLint config internals
  (`eslint-config/`) — project-specific lint surface definitions.

## Decision guide

Start with Tier 1 if:

- You have lint debt you want to freeze without a big-bang cleanup.
- You want pre-commit and CI enforcement that a specific rule is not getting
  worse.
- You do not have local ESLint rules or custom agent tooling.

Add Tier 2 when:

- You are writing local ESLint rules and want structured metadata and generated
  docs.
- You use AI coding agents and want them to receive lint findings as structured
  JSON with repair guidance.
- You want a committed inventory of which files are covered by which lint
  surface.
- You want CI to post a sticky PR comment with per-ratchet status and recovery
  commands.
