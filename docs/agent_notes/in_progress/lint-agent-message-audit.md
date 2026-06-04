# Lint Agent Message Audit

Status: audit pass complete, no code changes proposed yet.

Purpose: inventory the messages agents can see from the lint system, especially
ratchet/local-rule failures, and judge whether the advice steers agents toward
maintainable repairs rather than mechanical code-golf.

## Entry Points Checked

- `bun run lint`: ShellCheck, config sensors, normal ESLint with
  `--max-warnings=0`.
- `bun run lint:changed`: changed-file wrapper, with full-lint fallback when
  lint-affecting inputs change.
- `bun run lint:agent:local-rules` and `lint:agent:local-rules:changed`:
  structured JSON envelope for `local/*` findings and parser errors.
- `bun run lint:ratchet` plus `check-baseline`, `check-registry`, `update`,
  `report`, `summary`, `zero-baseline`, and `debt-log`.
- `bun run docs:lint-coverage-map:check`.
- PostToolUse lint hooks:
  `scripts/ai-hooks/ratchet-regression-check.sh` and
  `scripts/ai-hooks/lint-coverage-check.sh`.

`bun run lint:ratchet` currently exits 0 on this worktree and reports:
2 current baseline finding(s), 0 regression(s), 0 improvement(s).

## Normal ESLint Messages

Normal ESLint output is the normal formatter output from ESLint and its
plugins. Warnings still fail because lint wrappers use `--max-warnings=0`.
Third-party/core rule messages come from the package implementations at runtime,
so this audit separates repo-authored diagnostic text from plugin-owned text.

Repo-authored `local/*` rule messages:

- `local/concurrency-guard/noDirectWrite`: Why: Direct {{delegate}}.{{method}} bypasses the documented concurrency helper boundary. How to fix: {{suggestion}} Try `bun run codemod:concurrency-guard -- <file>` first (name-based only; aliases and destructured delegates still need a manual fix). See docs/CONCURRENCY.md.
- `local/e2e-prefer-role-selectors/preferRoleSelectors`: Prefer role/name selectors in e2e/. Use getByRole/getByLabel/getByText before falling back to CSS. See docs/guides/add-e2e-test.md for the recipe.
- `local/max-lines/exceed`: Why: This file has {{actual}} effective lines, above the {{max}} line limit, which makes future edits harder to localize. How to fix: Prefer splitting the module into focused components, helpers, or types. If it should stay larger for now, do not use eslint-disable; add or adjust a targeted override in eslint-config/shared-policy.js (maxLinesPolicy.exceptions) for this exact file with severity `warn`, choose a modest max just above the current count, and include a reason explaining the exception.
- `local/no-async-array-callbacks/droppedPromise`: Async callbacks passed to `{{method}}` are not awaited. Use `for...of` for sequential work, or `await Promise.all(items.map(async ...))` for parallel work.
- `local/no-async-array-callbacks/asyncPredicate`: Async predicates passed to `{{method}}` return Promise objects, not booleans. Resolve values with `await Promise.all(...)` first, then run `{{method}}` on the resolved data.
- `local/no-async-array-callbacks/asyncReduce`: Async reducers are easy to mis-order. Use a `for...of` loop for sequential accumulation, or resolve mapped promises before reducing.
- `local/no-async-array-callbacks/asyncMap`: Async `map` returns `Promise[]`. Consume it with `Promise.all`, `Promise.allSettled`, `Promise.race`, or `Promise.any`, and await or return that Promise.
- `local/no-barrel/noBarrel`: Use `bun run codemod:expand-barrel -- --barrel {{path}}` to replace this barrel file with direct imports.
- `local/no-broadcast-in-transaction/noBroadcastInTransaction`: Why: Broadcasting inside a Prisma `$transaction` callback can notify clients about state that later rolls back. How to fix: Persist first, then call {{name}} after the transaction resolves. See docs/guides/add-socket-broadcast.md.
- `local/no-explicit-any/noAny`: Why: `any` removes type checking from the value it touches. How to fix: Prefer `unknown` plus narrowing, an existing shared type, or a small local type for key concepts. If adding a type would be clutter rather than clarity, keep the `any` and suppress this exact line with `// eslint-disable-next-line local/no-explicit-any -- <why this boundary is intentionally untyped>`.
- `local/no-llm-artifacts/leftoverEditNote`: Remove this leftover editing note. Restore the real code or delete the comment.
- `local/no-llm-artifacts/todoNeedsReference`: TODO comments need a tracking reference. Link an issue, PR, roadmap entry, or agent note, or resolve the TODO now.
- `local/no-llm-artifacts/incompleteImplementation`: Replace this incomplete implementation with real behavior, or remove the dead path.
- `local/no-swallowed-errors/swallowedError`: Catch block only logs to console, so callers cannot detect the failure. Rethrow with `cause`, return a failure value, or delegate to a named error handler.
- `local/socket-registry-broadcasts/noDirectEmit`: Use {{helper}} instead of emitting "{{eventName}}" directly. Registry-owned socket events are payload-validated and logged in broadcast-registry.ts.
- `local/strict-shared-schemas/needsExplicit`: Use `.strict()` on exported `*InputSchema` z.object schemas, or `.passthrough()` only for intentional extra keys. See docs/guides/add-trpc-procedure.md.
- `local/strict-trpc-input/needsStrict`: Use `.strict()` on tRPC input `z.object(...)` schemas so unknown keys are rejected at the API boundary. See docs/guides/add-trpc-procedure.md.
- `local/structured-logging/noTemplate`: Why: Interpolated logger messages fragment log aggregation because the message text changes per value. How to fix: Move `${...}` values into the metadata object and keep the message static, for example `log.error({ userId }, 'failed')`.
- `local/structured-logging/noConcat`: Why: Concatenated logger messages fragment log aggregation because the message text changes per value. How to fix: Move concatenated values into the metadata object and keep the message argument static.
- `local/structured-logging/noDynamic`: Why: Dynamic logger message variables fragment log aggregation because the message text changes outside the call site. How to fix: Move the variable data into the metadata object and pass a static string literal as the message.
- `local/structured-logging/noConsole`: Why: Direct console calls bypass structured logging fields, request context, and log formatting. How to fix: Use structured logging instead, or run `bun run codemod:structured-logging-fix -- <file>`.
- `local/structured-logging/noScriptLoggerImport`: Why: createScriptLogger is only for seed, generator, Prisma seed, and server script entry points. How to fix: Use request or server log context in runtime server code instead.
- `local/test-file-location/wrongNaming`: Test file basename is missing a name prefix. Rename to `<feature>.test.ts`, `.test.tsx`, or `.spec.ts` so the file colocates with the code it covers.
- `local/test-file-location/missingTests`: Add a `describe`, `it`, or `test` block, or rename the file; helpers belong outside the test-file naming convention.
- `local/trpc-require-output-schema/missingOutput`: Add `.output(<sharedSchema>)` before `.{{method}}(...)`. Every router query and mutation must validate its response with a shared output schema.
- `local/trpc-shared-input-schema/needsSharedInput`: Why: Router input schemas are the client/server contract and must live in shared. How to fix: Move this input shape to packages/shared/src/schemas/<domain>-inputs.ts (run: `bun run codemod:trpc-shared-input -- <file>`). Move complex .extend/.merge/.and/.or shapes manually.
- `local/trpc-shared-output-schema/needsSharedOutput`: Why: Router output schemas are the client/server contract and must live in shared. How to fix: Move this output shape to packages/shared/src/schemas/<domain>.ts (run: `bun run codemod:trpc-shared-output -- <file>`). Move complex or wrapped output shapes manually.
- `local/type-assertion-boundary/missingBoundary`: Why: `as Foo` casts hide type bugs by silently overriding the checker. How to fix: Either rewrite to use a typed source (Zod parse, Prisma include shape, framework handler types), or - if this is a real boundary - add a comment `// type-assertion-boundary: <category> - <reason>` on the same line or directly above this statement. Allowed categories: framework, json, prisma, test, interop.
- `local/type-assertion-boundary/invalidCategory`: Why: The `type-assertion-boundary` comment is present but the category is not one of: framework, json, prisma, test, interop. How to fix: Update the comment to use an allowed category, or rewrite to avoid the cast.
- `local/type-assertion-boundary/emptyReason`: Why: The `type-assertion-boundary` comment is present but no reason follows the `-`. How to fix: Add a specific reason explaining why this cast is the narrowest fix at this boundary.

Repo-authored restricted-import/globals/syntax messages:

- Shared schema barrel: Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. The barrel was removed; see DX4.1 in docs/roadmap/developer-experience.md.
- Shared package importing server/client: packages/shared is the cross-package contract layer and must not depend on client or server modules.
- Shared package importing runtime adapters: packages/shared must stay runtime-neutral. Put browser/server adapters in packages/client or packages/server.
- Shared globals `window`, `document`, `localStorage`, `sessionStorage`: packages/shared must stay runtime-neutral; move browser code to packages/client.
- Raw `fetch` in client/server source: Use a sanctioned API helper instead of raw fetch. Client API calls go through tRPC (packages/client/src/lib/trpc.ts). Add a file to the allowlist override if this is a sanctioned framework boundary or upload endpoint.
- `RawTxClient` import: `RawTxClient may only be imported by utils/*-mutations.ts files. Go through a locked helper (see docs/CONCURRENCY.md).`
- Client Socket.io construction: Use the app SocketProvider/useSocket hooks instead of constructing another Socket.io client.
- `process.exit(...)`: Avoid process.exit(...) outside CLI/bootstrap entrypoints. Set process.exitCode and return/throw so finally blocks, log flushing, and socket teardown can run. If this IS a terminating entrypoint, add the file to the allowlist override in eslint.config.js.
- `process.env`: Avoid reading process.env outside config/env.ts. Use serverEnv from packages/server/src/config/env.ts (or add the key there). For child-process spawn `env:` pass-through and the db-status admin tool, add the file to the allowlist override below.

## Agent Local-Rule Envelope

`lint:agent:local-rules` maps `local/*` ESLint findings into structured
`HarnessDiagnostics` JSON:

- `why`: the rule `meta.docs.principle`.
- `howToFix`:
  - codemod: Run `<repairCommand>`.
  - autofix: Run `bun run lint:fix`.
  - suggestion: Apply the ESLint suggestion for this diagnostic.
  - manual: Repair manually following the paired guide (<pairedGuide>).
- Parser error finding:
  - `why`: `ESLint could not parse this file, so no other rule could run against it.`
  - `howToFix`: `Fix the syntax error reported by ESLint: <message>`
- Stderr status line:
  - `lint:agent:local-rules OK - <n> finding(s); blocking=<n> warning=<n> info=<n>`
  - Optional suffix: (skipped <n> non-local finding(s) - see `bun run lint` for the full view)

`lint:agent:local-rules:changed` wrapper messages:

- Missing base: lint:agent:local-rules:changed: neither '<base>' nor 'origin/<base>' exists - running full lint:agent:local-rules.
- No common history: lint:agent:local-rules:changed: '<base>' shares no history with HEAD - running full lint:agent:local-rules.
- Config changed: lint:agent:local-rules:changed: lint-affecting config changed - running full lint:agent:local-rules.
- No changed files: lint:agent:local-rules:changed: no changed lintable files vs <base> - emitting empty envelope.
- Checking files: lint:agent:local-rules:changed: checking <n> changed file(s) vs <base>.

## Lint Ratchet Messages

Default `lint:ratchet` stdout is a `HarnessDiagnostics` JSON envelope. Stderr:

- Clean: lint:ratchet OK - <current> current finding(s); 0 regression(s); 0 improvement(s); blocking=0 warning=0 info=0
- Drift: lint:ratchet FAIL - <current> current finding(s); <r> regression(s); <i> improvement(s); blocking=<n> warning=<n> info=<n>

Regression envelope fields:

- Local-rule ratchet `why`: Ratchet regression: <local rule principle>
- Core/third-party ratchet `why`: Ratchet regression for <ruleId>.
- Core/third-party ratchet with disposition reason:
  Ratchet regression for <ruleId>: <zeroBaselineDisposition.reason>
- Count regression `howToFix`:
  Reduce this file's <ruleId> finding count from <current> back to the committed baseline (<baseline>), or run `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` in a cleanup PR when the baseline movement is intentional.
- New-path count regression still uses the same count text with baseline `0`.
- Effective-line regression `howToFix`:
  Reduce this file's <ruleId> effective line count from <current> back to the committed baseline (<baseline>), or run `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` in a cleanup PR when the baseline movement is intentional.
- New-path effective-line regression target phrase:
  until this new path has no ratcheted finding
- Complexity regression `howToFix`:
  Reduce this file's <ruleId> complexity from <current> back to the committed baseline (<baseline>), or run `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` in a cleanup PR when the baseline movement is intentional.
- New-path complexity regression target phrase:
  until this new path has no ratcheted finding
- Local-rule ratchets prepend repair metadata:
  - codemod: Run `<repairCommand>`, then <lowercase ratchet fix>
  - autofix: Run `bun run lint:fix`, then <lowercase ratchet fix>
  - suggestion: Apply the ESLint suggestion, then <lowercase ratchet fix>
  - manual: Repair manually following the paired guide (<pairedGuide>), then <lowercase ratchet fix>

Improvement envelope fields:

- `why`: Current tree is better than the committed baseline for <ruleId>; lock it in.
- `howToFix`: Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.

`lint:ratchet:report` markdown messages:

- Header: ### Lint ratchet
- Clean: No ratchet findings. (clean)
- Footer clean: Recovery: nothing to do.
- Footer improvement-only: Recovery: `bun run lint:ratchet:update`
- Footer with any regression:
  Recovery: fix the regressions above; if the new findings are intentional, run `bun run lint:ratchet:update -- --allow-worse --reason "<why>"`.
- Finding bullets include:
  ` `<path[:line]>` - <baseline> -> <current> (why: <why>; fix: <howToFix>) `
- Large controls cap at 10 findings:
  _<n> more in artifact._

`lint:ratchet:check-baseline` messages:

- Clean: lint:ratchet:check-baseline OK - <n> current finding(s).
- Regression:
  current findings are worse than lint-ratchet.baseline.json for <n> path(s): <details>; run bun run lint:ratchet for details
- Improvement:
  current findings are better than lint-ratchet.baseline.json for <n> path(s): <details>; run bun run lint:ratchet:update
- Mixed:
  <worse details>; <better details>; fix regressions, then run bun run lint:ratchet:update
- Detail shapes:
  - `finding count increased/decreased from <baseline> to <current>`
  - `effective lines increased/decreased from <baseline> to <current>`
  - `complexity increased/decreased from <baseline> to <current>`
  - new path: new path has <n> effective lines` or `new path has complexity <n>

`lint:ratchet:update` messages:

- No baseline exists: first update writes without comparison.
- Worse without escape hatch:
  generated baseline is worse for <n> path(s); pass --allow-worse --reason "<why>" to accept intentional new debt
- Orphan baseline id without escape hatch:
  committed baseline carries <n> entr(y|ies) with no matching registry id (<ids>); this looks like a rename or removal - pass --allow-worse --reason "<why>" so count protection is not bypassed silently
- Missing reason: --allow-worse requires a non-empty --reason
- Previously clean ratchet accepted:
  lint:ratchet:update accepted new findings for a previously clean ratchet <id> (rule: <ruleId>): <n> path(s) - <path>: <count>. Inspect these paths before committing; fix accidental findings instead of baselining them.
- No-op: lint:ratchet:update OK - lint-ratchet.baseline.json already matches <n> current finding(s).
- Write: lint:ratchet:update OK - wrote lint-ratchet.baseline.json with <n> current finding(s).
- Accepted debt write suffix:
   Recorded the debt acceptance in lint-ratchet.debt-log.jsonl.

`lint:ratchet:check-registry` messages:

- Clean: lint:ratchet:check-registry OK - <n> ratchets validated.
- Failure header: lint:ratchet:check-registry FAIL - <n> failure(s).
- Preflight failure header in default mode:
  lint:ratchet registry preflight FAIL - <n> failure(s).
- Failure kinds and message shapes:
  - `registry-shape: <registry validation failure>`
  - `empty-glob: <ratchetId>: files globs match zero tracked files after ignores`
  - `absolute-path: <ratchetId>: <files|ignores> must use portable relative paths, not absolute local paths: <value>`
  - `orphan-baseline: <baseline>: <parse failure>`
  - `orphan-baseline: <ratchetId>: baseline has no matching registry id; this looks like a rename or removal`
  - `missing-harness-ratchet: ratchet <id> is not declared in the manifest as kind: "ratchet". Next steps: (1) add a kind: "ratchet" entry to harness.controls.json, (2) run bun run docs:harness-controls to regenerate the docs, (3) update scripts/test-harness-check.sh fixture if the smoke fixture copies live ratchets.`

Registry validation failure shapes include:

- `ratchet ids must be sorted and unique`
- `<id>: id must match ratchet/<name>`
- `<id>: parserProfile <value> is not implemented`
- `<id>: local ratchets must use parserProfile minimal-ts`
- `<id>: local source ruleId must match local/<rule-name>`
- `<id>: ruleId <ruleId> is not registered`
- `<id>: core ruleId must be a bare ESLint built-in id (no slash): <ruleId>`
- `<id>: third-party pluginModule must be a package name: <module>`
- `<id>: third-party source ruleId is not a valid lint rule identifier`
- `<id>: third-party source ruleId must be a non-local namespaced rule id`
- `<id>: third-party plugin <module> for namespace <namespace> is not allowlisted`
- `<id>: files must be non-empty`
- `<id>: files must be sorted and duplicate-free`
- `<id>: ignores must be sorted and duplicate-free`
- `<id>: file glob must be normalized: <value>`
- `<id>: ignore glob must be normalized: <value>`
- `<id>: mode <mode> is reserved but not implemented`
- `<id>: metric <metric> is not implemented`
- `<id>: effective-line-count metric requires ruleId local/max-lines`
- `<id>: complexity-severity metric requires core ruleId complexity`
- `<id>: target must be a non-negative integer`
- `<id>: ruleOptions must be JSON values`
- `<id>: duplicates ratchet scope already used by <previousId>`

Baseline/config failure shapes include:

- `lint-ratchet.baseline.json does not exist; run bun run lint:ratchet:update`
- `baseline JSON parse failed: <message>`
- `baseline must be an object`
- `version must be 1`
- `tests must be an object`
- `<ratchetId>.ruleId/mode/target/metric/files/ignores/ruleOptions/configHash is stale`
- `<ratchetId>.ruleSourceHash is required`
- `<ratchetId>.ruleSourceHash is stale (run "bun run lint:ratchet:update" to regenerate)`
- `<ratchetId>: baseline has no matching ratchet registry entry`
- `<ratchetId>: baseline is missing registry ratchet`
- `baseline JSON is not deterministic; run bun run lint:ratchet:update`

`lint:ratchet:zero-baseline` messages:

- Report header: # Lint Ratchet Zero-Baseline Audit
- Summary rows: `Zero-baseline ratchets`, `Normal-lint error coverage`,
  `Documented ratchet-only lifecycle`, `Needs lifecycle action`.
- Missing lifecycle gate:
  lint:ratchet:zero-baseline FAIL - <n> zero-baseline ratchet(s) lack zeroBaselineDisposition.
- Then:
  `Undocumented ratchets:` and `- <ratchet id>`.
- Next-action cells:
  - `Remove the ratchet, or document why it remains narrower than normal lint.`
  - `Promote normal lint to error, or document a temporary ratchet-only exit path.`
  - `Promote to normal lint, narrow the ratchet, or add documented ratchet-only lifecycle metadata.`

`lint:ratchet` usage/config errors:

- `lint:ratchet: choose only one mode`
- `lint:ratchet: --reason requires a non-empty argument`
- `lint:ratchet: --edit-check-targets requires at least one path`
- `lint:ratchet: --edit-check requires --targets-file`
- `lint:ratchet: --edit-ratchet-coverage requires at least one path`
- `lint:ratchet: --allow-worse is only valid with --update`
- `lint:ratchet: --reason is only valid with --update`
- `lint:ratchet: --allow-worse requires a non-empty --reason`
- `lint:ratchet: --input is not supported; use bun run lint:ratchet:report < diagnostics.json`
- `lint:ratchet: Unknown argument: <arg>`

## Lint Coverage Map Messages

`docs:lint-coverage-map:check` clean:

- `lint-coverage-map-check OK - <rows> row(s), <patterns> path pattern(s), <tracked> tracked file(s) checked.`

Failure header:

- `lint-coverage-map-check found drift:`

Sections:

- `Stale path/group patterns:`
  - `- line <n>: `<source>` (<pattern>) matched 0 tracked files`
- `Unknown ratchet IDs:`
  - `- line <n>: <ratchetId>`
- `Invalid status values:`
  - `- line <n>: <status>`
- `Unaccounted tracked files:`
  - grouped by directory.
- `ESLint reach gaps:`
  - `- line <n>: <missing> of <rowFiles> ESLint-managed file(s) have no ESLint config (e.g. `<sample>`)`

PostToolUse coverage hook:

- Ratchet-only info:
  lint-coverage (info): file(s) you just edited are covered only by lint:ratchet (single-rule floors), not full ESLint:
- Ratchet-only body:
  That's an accepted floor, not an error. If you added a new lint surface (a new directory or file group), add a row in docs/agent_notes/backlog/lint-followups/lint-coverage-map.md. The per-file counts there are descriptive, but new surfaces/globs should get a row.
- Uncovered warning:
  lint-coverage (WARNING): file(s) you just edited are NOT covered by ESLint at all:
- Uncovered body:
  If it should be linted, add it to eslint.config.js and the relevant tsconfig. Either way, account for it in docs/agent_notes/backlog/lint-followups/lint-coverage-map.md; verify:changed / pre-commit will block on source-relevant files matching no coverage-map row.
- Throttle note:
  This reminder is throttled per session: it won't repeat until about <minutes> min pass, <max> more matching edit batches are detected, or a new top-level session starts.

## Wrapper Messages

`lint:changed`:

- Missing base:
  lint:changed: neither '<base>' nor 'origin/<base>' exists - checking full repo working tree with ShellCheck, config sensors, and eslint.
- Full lint due config:
  lint:changed: lint-affecting staged/base config changed - checking full repo working tree with ShellCheck, config sensors, and eslint.
- No files:
  lint:changed: no staged/base changed lintable files vs <base> - skipping lint.
- Checking:
  lint:changed: checking <n> staged/base changed working-tree file(s) with eslint.

Changed verification unstaged gate:

- `<label>: source-relevant unstaged or untracked changes are present.`
- `<label>: stage the intended commit, or stash/restore unrelated source-relevant work, before running changed verification.`
- `<label>:   - <path>`

`lint:shell`:

- Unknown arg: lint:shell: unknown argument: <arg>
- Missing base: lint:shell: neither '<base>' nor 'origin/<base>' exists - checking full maintained shell set.
- No changed files: lint:shell: no staged/base changed maintained shell files vs <base> - skipping ShellCheck.
- No full files: lint:shell: no maintained shell files found - skipping ShellCheck.
- Tool missing:
  - `lint:shell: shellcheck is not available.`
  - `lint:shell: install the system package with `apt install shellcheck`, then rerun this command.`
- Checking:
  - `lint:shell: checking <n> staged/base changed maintained shell file(s) with ShellCheck.`
  - `lint:shell: checking <n> maintained shell file(s) with ShellCheck.`

`lint:config-sensors`:

- Unknown arg: lint:config-sensors: unknown argument: <arg>
- Missing base: lint:config-sensors: neither '<base>' nor 'origin/<base>' exists - checking full maintained config set.
- No changed files: lint:config-sensors: no staged/base changed maintained config files vs <base> - skipping sensors.
- No full files: lint:config-sensors: no maintained config files found - skipping sensors.
- Actionlint timeout:
  lint:config-sensors: actionlint timed out after <limit> on <file>
- Tool missing:
  - `lint:config-sensors: actionlint is not available.`
  - `lint:config-sensors: run `bun install` to install the pinned npm wrapper.`
  - `lint:config-sensors: yamllint is not available.`
  - `lint:config-sensors: install the system package with `apt install yamllint`, then rerun this command.`
  - `lint:config-sensors: taplo is not available.`
  - `lint:config-sensors: hadolint is not available.`
- Checking:
  - `lint:config-sensors: actionlint checking <n> workflow file(s).`
  - `lint:config-sensors: actionlint checking <file>.`
  - `lint:config-sensors: yamllint checking <n> YAML file(s).`
  - `lint:config-sensors: taplo format-checking <n> TOML file(s).`
  - `lint:config-sensors: taplo linting <n> TOML file(s).`
  - `lint:config-sensors: hadolint checking <n> maintained Dockerfile(s).`
  - `lint:config-sensors: hadolint checking <n> local reference Dockerfile(s).`

`lint` / `lint:changed` parallel runner:

- Step banner: === <label> ===
- Failure summary: <context>: <label> failed with exit <code>

`verify`/`verify:changed` relevant lint-facing messages:

- Timeout:
  - `=== <label> TIMED OUT (<seconds>s) ===`
  - `Timed out and stopped the verification process tree.`
  - `For deliberate long verification, use bun run verify:async[:changed] and check bun run verify:async:status.`
  - `logs: <dir>`
  - `inspect: bun run verify:logs budget`
- Failure:
  - `=== <label> FAILED (<seconds>s) ===`
  - `Passed:<tasks>`
  - `Failed:<tasks>`
  - `--- <task> (full log: <dir>/<task>.log) ---`
  - lint hint: Hint: try 'bun run lint:fix' to auto-fix formatting issues.
  - format hint: Hint: run 'bun run format:changed' to apply Prettier to changed files, or 'bun run format' for the full tree.
- Success:
  - `<label>: OK (<seconds>s) -<tasks>`
- Cache skip:
  - `<label>: already verified <n>s ago at <head> - skipping (set FORCE_VERIFY=1 to re-run).`

## PostToolUse Ratchet Regression Hook

Regression warning:

```text
lint-ratchet (WARNING): your edit introduced or worsened a ratchet finding in file(s) you just edited:
  - <path[:line]> (<ruleId> - <reason>)
  (+<n> more matching target(s) not checked this edit; run bun run lint:ratchet for the full picture.)
Run bun run lint:ratchet before committing. Type-aware ratchets are not checked in this edit-time hook. Disable entirely with: touch <repo>/.no-edit-lint
```

Partial-check note:

```text
lint-ratchet (note): your edit matched more ratchet targets than were checked at edit time; the checked subset found no regression.
  (+<n> more matching target(s) not checked this edit; run bun run lint:ratchet for the full picture.)
Run bun run lint:ratchet before committing. Type-aware ratchets are not checked in this edit-time hook. Disable entirely with: touch <repo>/.no-edit-lint
```

The hook is advisory and degrades to silence on tooling failure.

## Advice-Quality Findings

Strong messages:

- `local/max-lines/exceed` directly addresses the code-golf concern: it tells
  agents to split into focused modules/helpers/types, and if that is not right,
  to add a targeted `maxLinesPolicy.exceptions` override with a reason. It also
  says not to use `eslint-disable`.
- `lint:ratchet:update` and `lint:ratchet:report` clearly expose the worse
  baseline escape hatch: `bun run lint:ratchet:update -- --allow-worse --reason "<why>"`.
- Improvement failures are clear: they tell agents to run
  `bun run lint:ratchet:update` to lock in a lower baseline.
- Coverage hook distinguishes accepted ratchet-only floors from truly
  uncovered files.
- Local-rule metadata gives agents a principle, paired guide, repair kind, and
  codemod command when available.

Potential weak spots:

- Ratchet regression `howToFix` for line/complexity metrics starts with
  `Reduce this file's ...`. For `local/max-lines`, normal ESLint also provides
  the stronger refactor/exception message, but the ratchet envelope by itself
  may still nudge toward shrinking text rather than evaluating a real module
  split. Consider changing the ratchet line-count text to say: "Prefer a
  focused extraction that reduces effective lines..." and keep the
  `--allow-worse --reason` escape hatch.
- The accepted-worse command says "in a cleanup PR"; during active feature work,
  that phrase may imply agents should not use the escape hatch in the current
  change even when the current change is the right place to record accepted
  debt. Consider "in the same reviewed change" or "when this baseline movement
  is intentional and reviewed."
- `lint:agent:local-rules` manual `howToFix` is generic:
  `Repair manually following the paired guide (...)`. The raw ESLint message is
  often more specific, but the structured envelope does not carry that message.
  If agents consume only the envelope, adding `messageId` plus the original
  ESLint `message` or a per-message `howToFix` would improve repair quality.
- Several exempt local messages are terse policy messages. They pass the
  current guidance convention, but the weaker ones are `e2e-prefer-role-selectors`,
  `socket-registry-broadcasts`, and `strict-*` because they do not use the
  explicit `Why: ... How to fix: ...` format. They still name the sanctioned
  alternative and guide, so this is a low-risk consistency issue.
