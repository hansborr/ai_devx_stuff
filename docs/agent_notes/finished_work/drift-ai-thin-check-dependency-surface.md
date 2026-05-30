# drift:ai — Thin the Plugin Dependency Surface (review pack task 11)

Landed the plugin-owned dependency refactor so adding a check no longer grows the
central run-context surface.

## What changed

- `check-plugin.ts` now defines:
  - `CheckRunState` — common run state (scope, repoRoot, config, roots,
    sourceExtensions, inventoryByDir, suppressionDiffRef, warnStderr).
  - `CheckOverrides` — the injectable runner seam (jscpd/knip/moduleGraph/
    nearDuplicates/listDirectory/readFile/suppressionsGit/git/pathExists/binExists).
  - `CheckServiceEnv = { repoRoot, overrides, cli }`.
  - `CheckRunInput = CheckRunState & { env }` — what `buildReport` receives.
  - `CheckRunContext<S> = CheckRunState & { services: S }` — what run/preflight see.
  - `CheckPluginDefinition` gained a required `resolveServices(env): S` hook.
- `runWithSelectedConfig(input)` resolves services per **selected** check and only
  on dispatch, so an unselected check never pays for tool/graph resolution.
- Per-check resolution moved out of `runner.ts` into each `*-check.ts`
  (`resolveJscpdSetup`, `resolveKnipRunner`, default graph/runner/reader/probe
  wiring). `jscpdUnavailableReason`/`knipConfigOverride`/`tsconfigOverride` are now
  fields on the owning plugin's service object (`ctx.services.*`).
- `runner.ts` shrank to assembling state + env; `RunOptions` gained `binExists`.

## Non-obvious gotcha (load-order cycle)

Moving `defaultModuleGraphRunner`/`defaultNearDuplicateRunner` into the plugin
files made plugins statically import `import-cycles-graph`/`near-duplicates-runner`
→ `source-walk` → `git-changed-scope` → `config.js` → `config-parsing` →
`check-registry`. Because `config-defaults.ts` **eagerly** called
`buildDefaultChecksConfig()` (reads `CHECK_PLUGINS`) at module load, this re-entered
`check-registry` mid-init → TDZ.

Fixed in two places (both also make the graph genuinely acyclic at runtime):

1. `config-defaults.ts` — `DEFAULT_DRIFT_AI_CONFIG.checks` is now a memoized lazy
   getter (defers the registry read past init); the registry stays the single
   source of per-check defaults.
2. Moved the `isIgnoredPath` core into the leaf `config-match.ts` as
   `isPathIgnored(path, ignore)`; `source-walk` imports that instead of the heavy
   `git-changed-scope` (which keeps a thin default-applying `isIgnoredPath` wrapper).

Verification: scripts vitest 774 pass; `tsc -p tsconfig.scripts.json` clean;
`bun run drift:ai --scope current --root scripts/drift-ai --check all` reports only
pre-existing type-only cycles (no runtime cycle) plus the usual evidence findings.
