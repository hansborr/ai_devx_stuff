# Lint Ratchet

The lint ratchet tracks selected existing lint debt without allowing it to
grow. Normal `bun run lint` stays strict; `bun run lint:ratchet` is an
additional gate for rules that are being drained from a committed baseline.

## Commands

- `bun run lint:ratchet` emits a `harness-diagnostics` envelope and fails when
  a ratcheted file has a new finding, a higher finding count, or a
  metric-specific severity increase than the committed baseline.
- `bun run lint:ratchet:check-baseline` validates that
  `lint-ratchet.baseline.json` is deterministic and still matches the ratchet
  registry. Improvements are reported but do not fail the gate.
- `bun run lint:ratchet:update` rewrites the baseline from the current tree
  when counts are equal or lower. If a rename or intentional policy change makes
  the generated baseline worse, use
  `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` and put the
  durable rationale in the commit message.

## Metrics And Baseline Items

Registry entries choose one metric:

- `message-count` stores per-file `{ "count": N }` and fails when the current
  diagnostic count for a path is higher than the committed count. This remains
  the default for bug-class and finding-class rules where each new violation is
  already a separate ESLint diagnostic.
- `effective-line-count` is reserved for `local/max-lines`. It stores
  `{ "count": 1, "lines": N }` for each over-limit file. The count still catches
  new over-limit files, while `lines` catches an already-over-limit file getting
  longer even though ESLint still emits only one diagnostic for that file.

The runner reads the `local/max-lines` effective count from the rule's own
interpolated message (`This file has <N> effective lines...`) instead of
reimplementing the rule's blank-line/comment logic. If that message shape
changes, the ratchet fails loudly and the rule-source hash also forces a
baseline review.

Default and check-baseline modes require metric-specific fields. For a converted
`effective-line-count` ratchet, a count-only committed item is a schema mismatch.
`update` mode uses structural parsing so one-shot migrations can rewrite old
count-only entries, but it still refuses any generated count or `lines`
regression unless `--allow-worse --reason "<why>"` is supplied.

## Current Ratchets

- `ratchet/local-max-lines` tracks `local/max-lines` by effective line count
  across the default 300-effective-line scope. Files with explicit higher caps
  in `eslint.config.js` remain governed by those local overrides instead of
  being mixed into this default-options ratchet.
- `ratchet/local-type-assertion-boundary` tracks
  `local/type-assertion-boundary` by per-file message count across package,
  script, and e2e TypeScript files.
- `ratchet/strict-boolean-expressions-shared` tracks
  `@typescript-eslint/strict-boolean-expressions` by per-file message count
  across `packages/shared/src` production TypeScript. The initial 6-finding
  scope and options came from the Leaf 23 inventory in
  `docs/agent_notes/finished_work/lint-strict-boolean-expressions-ratchet-leaf-23.md`.

For `ratchet/local-max-lines`, the exact-path ignores in
`scripts/lint-ratchet-config.ts` mirror the per-file higher-cap overrides in
`eslint.config.js`. When renaming or splitting one of those files, update both
lists in the same change so the ratchet and ESLint gate keep the same scope.
Script or test max-lines debt should normally get its own narrowly named
ratchet instead of expanding this default package-oriented scope.

Path renames move baseline keys. A rename that keeps or lowers the count should
update the baseline in the same commit. A rename that also increases the count
needs the explicit `--allow-worse --reason` path.

## Baseline Identity

Each baseline test stores both a `configHash` (covering the ratchet's `files`,
`ignores`, `ruleOptions`, mode, metric, target, and any non-default
source/parser profile identity) and a `ruleSourceHash`. For local rules,
`ruleSourceHash` is the SHA-256 of the matching `eslint-rules/<name>.js`. For
third-party rules, it is the SHA-256 of the allowlisted plugin identity,
including plugin package name, package version from
`node_modules/<package>/package.json`, plugin export mode, and rule namespace.
For core ESLint rules, it is the SHA-256 of the core rule identity, including
the rule id, rule options, and installed ESLint package version from
`node_modules/eslint/package.json`.
The default and check-baseline gates run a strict parse that fails when either
hash drifts: edit the rule implementation, upgrade a ratcheted plugin, or
change the registry entry and re-run `bun run lint:ratchet:update` to refresh
both. The cache directory under `node_modules/.cache/eslint-ratchet/` is keyed
by generated ESLint config identity plus rule-source identity, so changes to
rule options, files, ignores, parser profile, local rule source, third-party
plugin version, or ESLint package version invalidate cached findings
automatically. Metric-only changes update the baseline identity but intentionally
do not churn generated ESLint config bytes or cache paths.

ESLint's per-file cache is only used for `minimal-ts` ratchets. `type-aware-ts`
ratchets intentionally omit `--cache` because ESLint's cache key follows direct
source bytes, not imported type dependencies; a schema type edit can otherwise
leave an unchanged consumer file with a stale clean result. The tradeoff is that
type-aware ratchets re-lint their full scope on every run, so cold and warm
runtime are expected to be similar.

`update` mode uses a structural parse that tolerates stale or missing hashes
so it can re-baseline cleanly across registry edits, rule rewrites, and the
first run after Leaf 01. Count regressions are still rejected unless
`--allow-worse --reason "<why>"` is supplied.

## Rule Sources And Parser Profiles

Ratchet registry entries default to an implicit local source with the
`minimal-ts` parser profile. That preserves the original local generated
`eslint.config.mjs` bytes and cache keys for the current `local/*` ratchets,
so existing baselines do not churn. Local entries may spell
`source: { kind: "local" }`, but do not need to.

Third-party entries must be explicit:

- `source: { kind: "third-party", pluginModule: "<npm-package>" }`
- `ruleId: "<plugin-namespace>/<rule-name>"`
- `parserProfile: "minimal-ts"` or `parserProfile: "type-aware-ts"`

`minimal-ts` is the current no-type-info profile: `tseslint.parser` with
`ecmaVersion: "latest"`, `sourceType: "module"`, and JSX parsing enabled.
`type-aware-ts` mirrors the project-service knobs in `eslint.config.js`:
`projectService: true` with `tsconfigRootDir` set to the repository root.
The profile only changes parser configuration; the entry's `files` and
`ignores` still control scope, including generated, dist, and fixture paths.

Third-party plugins are not loaded by arbitrary module name. Add a package to
`lintRatchetThirdPartyPluginAllowlist` in `scripts/lint-ratchet-config.ts`
before adding an entry that uses it. The allowlist binds an npm package name to
the ESLint rule namespace it is allowed to provide. `pluginExport` defaults to
`"default"` for the plugin module's default export; set
`pluginExport: "plugin"` for packages that expose rules from `module.plugin`,
such as typescript-eslint's combined export. A third-party ratchet whose
package/namespace pair is absent from the allowlist fails registry validation
before ESLint runs. This keeps plugin upgrades, namespace choices, and cache
identity reviewable in the same diff as the ratchet entry.

Core ESLint entries use `source: { kind: "core" }` with a bare built-in rule id
such as `complexity`; slashed ids are rejected and no allowlist entry is needed.
Core ratchets can use either parser profile, and their source hash includes the
installed ESLint package version so upgrades invalidate cached findings. Leaf 41
Batch 6 is planned as the first core-rule user.

## Adding a Ratchet

Adding a new `ratchet/<name>` entry to `lintRatchets` and running
`bun run lint:ratchet:update` writes its current finding counts straight into
`lint-ratchet.baseline.json` without any allowlist gate. That's intentional —
the goal is to capture present debt as the floor, not to require an
`--allow-worse` ack on day one. Review the diff: the initial counts become the
ceiling everyone else has to ratchet down from, so the PR introducing a new
ratchet should land alongside whatever doc/code changes make the ceiling
meaningful.

For a local rule, add the registry entry with a `local/<rule-name>` `ruleId`
and no `source` field unless the explicit local marker improves readability.
For a third-party rule, first add the package/namespace pair to
`lintRatchetThirdPartyPluginAllowlist`, then add the ratchet entry with an
explicit third-party source and parser profile. Leaf 22 added this
infrastructure; Leaf 23 used it for the first real third-party/type-aware
ratchet.

Core ESLint rules such as `complexity`, `max-params`, and
`no-nested-ternary` use the explicit core source shape described above and a
bare built-in rule id.

## Adoption Patterns

Use ratchets when a useful lint rule cannot be enabled everywhere at once
without stopping unrelated work. The important sequence is the same in each
case: inventory the current findings, commit that count as the ceiling, prove
new findings fail, and then drain the baseline in smaller changes. A ratchet is
a floor that keeps debt from growing; the first change may be inventory plus
floor plus baseline only, with cleanup deferred until a later prioritized slice.

### Bringing an Unlinted Area Under Coverage

This is the path for scripts, codemods, generated-adjacent tooling, local ESLint
rules, shell hooks, config files, workflows, agent configs, devcontainer files,
or any other tracked maintained code/tooling that normal `bun run lint` does
not yet inspect.

1. Map the current coverage boundary. Identify which files are ignored by
   normal ESLint, which parser profile they need, and which fixture or generated
   paths must stay ignored. For broad coverage sweeps, commit a map artifact
   derived from `git ls-files`, checked against the actual ESLint
   ignore/unignore/parser config and current ratchet registry. In this repo,
   the durable map path is
   `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`. Classify
   tracked maintained surfaces as normal lint, existing ratchet/floor, proposed
   floor, intentional exclusion, or named blocker/follow-up; do not start
   baselining batches while any temporary `unknown` classification remains.
2. Run a scoped inventory with the rule set you want to enforce. Keep the
   inventory narrow enough that the first baseline is reviewable by file family
   or tool surface.
3. Add a ratchet entry in `scripts/lint-ratchet-config.ts` with explicit
   `files`, `ignores`, rule options, source, and parser profile. Prefer a
   family-level scope when the rule and parser needs are coherent; split by file
   or tool when the baseline would be too noisy. Avoid overlapping ratchets for
   the same rule/file pair; if multiple cleanup leaves share a tool family, one
   broader rule-specific ratchet with precise file membership is often clearer
   than sibling ratchets that must stay synchronized.
4. Run `bun run lint:ratchet:update` and review
   `lint-ratchet.baseline.json`. The initial baseline is the maximum allowed
   debt for that scope.
5. Run `bun run lint:ratchet` and
   `bun run lint:ratchet:check-baseline`. For new source kinds or parser
   behavior, also add or update the focused ratchet smoke tests.
   If the baseline has zero findings, prove the scope is not empty by
   temporarily introducing a small violation in an in-scope file, confirming
   `bun run lint:ratchet` reports it, and reverting the probe before commit.
6. Drain findings in follow-up commits. Cleanup does not have to happen in the
   same slice as the floor, but the floor must exist before cleanup is deferred.
   When the baseline reaches zero and the area is compatible with the main
   ESLint config, add it to normal `bun run lint` coverage and remove or narrow
   the temporary ratchet if it is no longer needed.

Do not clean first and add enforcement later. The ratchet should land before
large refactors so new debt is blocked while the cleanup is still in progress.
Keep ratchets in local/pre-commit verification for this repository; runtime
problems should be solved by improving the runner, not by relying on external CI
as the only enforcement point.

When adding several ratchets, land them in small coherent batches and re-measure
`bun run lint:ratchet` after each batch. If runtime becomes painful, improve the
runner before adding the next batch. Bug-class findings should also get an
explicit near-term drain plan, even when the first step is still to baseline the
current count.

Not every floor has to be implemented by `lint:ratchet` on day one. For shell,
YAML, TOML, GitHub Actions, or other non-ESLint surfaces, use `lint:ratchet`
when the runner can express the rule; otherwise add or document an equivalent
local/pre-commit sensor with a committed current baseline/count and a clear
named blocker or child follow-up for folding it into the ratchet runner later.
Treat each non-ESLint tool family as its own small infrastructure change when
needed, such as ShellCheck for shell/hooks, actionlint for workflows, and
yamllint/taplo/jsonschema-style checks for config metadata. The key property is
local enforcement that prevents new or worse findings.

### Adding a New Rule to an Already Linted Area

This is the path for a stricter rule over code that already passes normal
`bun run lint`, such as adding a third-party TypeScript rule to one package
before rolling it out across the monorepo.

1. Pick the smallest useful scope: a package, source directory, production-only
   subset, or test-only subset. Reuse existing ESLint ignores unless the new
   rule intentionally covers a different surface.
2. Decide whether the rule needs type information. Use `minimal-ts` when syntax
   is enough and `type-aware-ts` when the rule depends on TypeScript project
   service behavior.
3. If the rule is third-party, add its package and namespace to
   `lintRatchetThirdPartyPluginAllowlist` before adding the ratchet. This makes
   plugin identity, package version, and cache invalidation reviewable. If the
   rule is core ESLint, use `source: { kind: "core" }` with a bare built-in id
   as described in Rule Sources And Parser Profiles.
4. Add the ratchet entry with the same rule options you plan to use for eventual
   normal ESLint enforcement.
5. Run `bun run lint:ratchet:update`, review the baseline, then run
   `bun run lint:ratchet` and `bun run lint:ratchet:check-baseline`.
   For zero-finding scopes, use the same temporary-violation probe described
   above to prove the files are actually covered.
6. Drain the baseline in focused changes. Once the baseline is zero and the
   rule is no longer experimental for that scope, move it into the normal ESLint
   config for that scope or keep the ratchet only if staged rollout still needs
   separate ownership.

When adapting this setup to another project, preserve the three core pieces:
a registry of scoped rules, a committed per-file baseline, and a gate that
fails only when counts increase. The exact parser profiles, cache identity, and
plugin allowlist can be simpler or stricter depending on that project's lint
surface.
