# Biome Lint Adoption

This guide is for projects that want a Biome-based lint setup while preserving
the useful parts of Musi's lint harness: custom repair guidance, the post-edit
tidy hook, and ratcheted adoption of rules with existing findings.

Musi remains ESLint-first today. Treat this as an adapter guide, not an
implementation decision.

Audit note: checked on 2026-05-26 against `@biomejs/biome` 2.4.15 and the
current Biome docs. Biome moves quickly; re-check the linked docs before
committing to a migration.

## Musi Surfaces

The portable system has three layers:

- Guidance and machine-readable diagnostics:
  `scripts/lint-rule-docs.ts`, `scripts/generate-lint-guidance.ts`,
  `docs/generated/local-lint-rules.md`, `scripts/lint-agent.ts`,
  `scripts/lint-agent-changed.sh`, and
  `packages/shared/src/schemas/harness-diagnostics.ts`.
- Agent edit-loop hooks: `scripts/ai-hooks/tidy-edited-file.sh`,
  `scripts/ai-hooks/common.sh`, the thin wrappers under `.codex/hooks/` and
  `.claude/hooks/`, and the corresponding `.codex/hooks.json` /
  `.claude/settings.json` entries.
- Ratchet runtime: `scripts/lint-ratchet-config.ts`,
  `scripts/lint-ratchet/modes.ts`, `scripts/lint-ratchet-baseline-compare.ts`,
  `scripts/lint-ratchet/current-collector.ts`,
  `scripts/lint-ratchet/diagnostics.ts`, and
  `lint-ratchet.baseline.json`.

Adopters should also review `package.json` scripts, `.husky/pre-commit`, CI
workflow steps, and `scripts/path-policy.ts`, because changed-file selection
and full-scan triggers are part of the user experience.

## Recommended Shape

Pick one of these positions before writing code:

- **Conservative hybrid:** keep ESLint authoritative for custom rules,
  `lint:agent:local-rules`, and `lint:ratchet`; add Biome only as a fast
  advisory or safe-fix tier for mechanical rules.
- **Biome-native for selected rules:** use Biome for built-in rules and simple
  GritQL plugin rules, but keep Musi's guidance metadata and ratchet baseline
  logic in project-owned scripts.
- **Biome-first:** replace ESLint local rules where Biome has equivalent
  built-ins or maintainable GritQL plugins, then port the agent envelope and
  ratchet runner to parse Biome diagnostics.

The conservative hybrid is the lowest-risk reference setup. It lets adopters
benefit from Biome speed without giving up ESLint plugin compatibility,
autofixes, suggestions, or complex local rules.

## Biome Capabilities To Account For

Useful current Biome surfaces:

- `biome lint`, `biome check`, and `biome ci` cover lint, format, and assist
  workflows. `check` includes formatter, linter, and import sorting; `lint`
  only runs lint rules.
- `--write` applies safe fixes. `--write --unsafe` also applies unsafe fixes;
  do not use unsafe fixes in automatic post-edit hooks.
- `--only` and `--skip` can scope a run to individual rules, groups, domains,
  or assist actions.
- VCS integration supports `--changed`, `--since`, and `--staged` after
  enabling Git in `biome.json`.
- Biome CLI arguments accept files and directories. Biome discourages CLI
  globs; use `files.includes` in configuration for glob-style scopes.
- GritQL plugins can register custom diagnostics for JavaScript and CSS
  patterns.
- Suppressions use `biome-ignore`, `biome-ignore-all`,
  `biome-ignore-start`, and `biome-ignore-end` comments with explanations.
- `--reporter=json` exposes diagnostics, but Biome documents this reporter as
  experimental and subject to patch-release changes.

Primary references:

- [Biome linter](https://biomejs.dev/linter/)
- [Biome CLI](https://biomejs.dev/reference/cli/)
- [Biome configuration](https://biomejs.dev/reference/configuration/)
- [Biome reporters](https://biomejs.dev/reference/reporters/)
- [Biome linter plugins](https://biomejs.dev/linter/plugins/)
- [Biome VCS integration](https://biomejs.dev/guides/integrate-in-vcs/)
- [Biome Git hooks](https://biomejs.dev/recipes/git-hooks/)
- [Biome ESLint/Prettier migration](https://biomejs.dev/guides/migrate-eslint-prettier/)
- [Biome suppressions](https://biomejs.dev/analyzer/suppressions/)

## Custom Guidance

Musi's custom guidance is not just an ESLint message. It is a small metadata
pipeline:

- `eslint-rules/*` rules carry `meta.docs`.
- `eslint-rules/message-guidance.test.js` enforces concise diagnostic message
  shapes.
- `scripts/lint-rule-docs.ts` validates `description`, `principle`,
  `category`, `pairedGuide`, `repairKind`, and optional `repairCommand`.
- `scripts/generate-lint-guidance.ts` writes
  `docs/generated/local-lint-rules.md`.
- `scripts/lint-agent.ts` parses ESLint JSON and emits the shared
  `HarnessDiagnostics` envelope from
  `packages/shared/src/schemas/harness-diagnostics.ts`.
- `scripts/lint-agent-changed.sh` scopes the envelope to changed lintable files,
  falls back to a full scan when lint-affecting config changes, and emits an
  empty valid envelope when nothing relevant changed.

For Biome, keep the same idea but move the metadata out of ESLint rule objects.
Use a project-owned registry keyed by Biome diagnostic category:

```ts
export const biomeGuidance = [
  {
    category: "lint/style/useConst",
    control: "lint/biome/use-const",
    why: "Single-assignment variables should be constants so later mutation is explicit.",
    howToFix: "Run `biome lint --write` or change the declaration to `const`.",
    repairKind: "autofix",
    pairedGuide: "docs/guides/local-eslint-rules.md",
  },
] as const;
```

Then add a `scripts/biome-agent.ts` equivalent of `scripts/lint-agent.ts`:

- Run pinned Biome, for example
  `node_modules/.bin/biome lint --reporter=json --files-ignore-unknown=true`.
- Parse the reporter output behind a fixture-tested adapter. Pin the Biome
  version because the JSON reporter is experimental.
- Normalize `diagnostics[].category` into `ruleId` or `control`.
- Map Biome severities: `error -> block`, `warning -> warn`, `information` or
  `info -> info`.
- Use `diagnostics[].location.path` and `location.start.line` for file
  location.
- Join each diagnostic to the registry entry and emit the same
  `HarnessDiagnostics` schema.

For GritQL plugins, do not rely on Biome to provide an ESLint-style
`local/<rule>` id. In a 2.4.15 smoke, a plugin diagnostic reported category
`plugin`. Use one of these conventions:

- Run one Grit plugin per wrapper or ratchet invocation, so the wrapper already
  knows which plugin produced `category: "plugin"`.
- Prefix plugin messages with a stable id such as
  `[local/no-object-assign] Prefer object spread...`, then strip the prefix in
  the wrapper.
- Keep complex local rules in ESLint or a custom script until Biome plugin
  diagnostics can carry all metadata the project needs.

Built-in Biome rules that accept custom messages, such as import restriction
rules, can carry short policy text in `biome.json`. Still keep repair kind,
paired guide, and codemod command metadata in the external registry so agent
output remains structured.

## Post-Edit Hook

Musi's post-edit hook lives in `scripts/ai-hooks/tidy-edited-file.sh`. It
extracts edited paths from Claude/Codex payloads, skips unsafe paths and binary
files, then runs Prettier and `eslint --fix` per supported file.
`scripts/ai-hooks/common.sh` owns shared payload and output helpers; the
`.codex/hooks/tidy-edited-file.sh` and `.claude/hooks/tidy-edited-file.sh`
wrappers keep adapter-specific wiring thin.

For a Biome-only project, the hook body can collapse to one command:

```sh
biome check --write --files-ignore-unknown=true --no-errors-on-unmatched "$absolute_path"
```

That command can format, lint, organize imports, and apply safe fixes.

For a hybrid project where Prettier, ESLint, or `simple-import-sort` still owns
part of the edit surface, do not run all fixers blindly. Use one of these
narrower forms:

```sh
# Biome safe lint fixes only.
biome lint --write --files-ignore-unknown=true --no-errors-on-unmatched "$absolute_path"

# Or keep the check command but disable formatter and assist work.
biome check --write --formatter-enabled=false --assist-enabled=false \
  --files-ignore-unknown=true --no-errors-on-unmatched "$absolute_path"
```

Hook adoption checklist:

- Decide one owner for formatting and one owner for import ordering.
- Never use `--unsafe` in a post-edit hook.
- Keep the current skip behavior for missing, deleted, outside-repo,
  unsupported, and binary files.
- Keep the hook non-blocking and bounded; failed cleanup should report concise
  context rather than hiding the original edit.
- Preserve `SKIP_TIDY_HOOK` or an equivalent emergency escape hatch for local
  debugging.
- Update extension detection to match the Biome-supported languages the project
  actually enables.
- Add fixture tests for success, unsupported files, formatter/linter failures,
  and bounded output, matching the current `scripts/ai-hooks/test.sh` pattern.
- Run a diff-churn experiment before combining Biome with Prettier or ESLint
  autofix in the same hook.

Adjacent hook note: `scripts/ai-hooks/lint-coverage-check.sh` is currently
ESLint-specific because it checks ESLint coverage after edits. A Biome-first
setup needs either a Biome-aware replacement or an explicit decision to keep
that hook tied to ESLint-owned surfaces.

## Lint Ratchet

Most of the ratchet design can survive a Biome adapter:

- Keep the registry, committed baseline, strict parser, comparison logic,
  summary/report modes, and `HarnessDiagnostics` output.
- Keep the coverage map idea. A ratchet still proves "this selected rule did
  not get worse"; it does not prove every maintained file has a lint owner.
- Keep full ratchet runs authoritative. Use Biome `--changed` only for
  advisory fast loops; Biome's own docs note that changed mode processes files
  with diffs and does not check downstream files.

The ESLint-specific pieces that need an adapter are:

- `scripts/lint-ratchet/eslint-runner.ts`
- `scripts/lint-ratchet/eslint-config.ts`
- the `source.kind` union in `scripts/lint-ratchet-config.ts`
- rule-source hashing in `scripts/lint-ratchet/baseline-hash.ts`
- package/local source identity in `scripts/lint-ratchet/rule-source.ts`
- ESLint message filtering and metric extraction in
  `scripts/lint-ratchet/current-collector.ts`
- local-rule guidance lookup in `scripts/lint-ratchet/diagnostics.ts`
- zero-baseline promotion checks that ask ESLint for resolved config
- ESLint reach checks in `scripts/lint-coverage-map-check-eslint-reach.ts`

A Biome ratchet entry should identify the engine and diagnostic category
directly:

```ts
{
  id: "ratchet/biome-use-const-src",
  engine: "biome",
  category: "lint/style/useConst",
  files: ["src/**/*.ts", "src/**/*.tsx"],
  ignores: ["src/**/*.test.ts", "src/generated/**"],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
}
```

For built-in Biome rules, the runner can either pass `--only=style/useConst` or
write a generated Biome config that disables recommended rules and enables just
the ratcheted rule. Prefer config `includes` over CLI globs. Biome v2 resolves
config globs relative to the config file, so either write the generated config
at the repository root or rewrite every include relative to the cache directory:

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "files": {
    "includes": ["src/**/*.ts", "src/**/*.tsx", "!src/**/*.test.ts"]
  },
  "linter": {
    "rules": {
      "recommended": false,
      "style": {
        "useConst": "error"
      }
    }
  }
}
```

Run the generated config with a pinned local binary:

```sh
node_modules/.bin/biome lint --reporter=json \
  --config-path biome-ratchet.use-const.json \
  --files-ignore-unknown=true --no-errors-on-unmatched
```

Hash enough state to make baseline drift meaningful:

- ratchet id, category, files, ignores, mode, metric, target, and rule options
- `@biomejs/biome` package version
- generated config content and any base `biome.json` it extends
- Grit plugin source files
- guidance registry entries that affect `why`, `howToFix`, repair kind, or
  repair command

Metric support is not automatic. `message-count` maps cleanly to Biome
diagnostics. Metrics like Musi's `effective-line-count` and
`complexity-severity` only work if the Biome diagnostic exposes stable numeric
data or a project-owned sensor computes it. If not, keep those ratchets on
ESLint or split them into separate custom checks.

## Porting Triage

Good first Biome candidates:

- Mechanical built-ins such as `lint/style/useConst`,
  `lint/correctness/noUnusedImports`, and `lint/suspicious/noDebugger`.
- Import restrictions where Biome options can carry the policy.
- Simple syntax patterns that fit a GritQL query and only need a diagnostic.
- Formatter and import organization only when Biome is the chosen owner.

Keep in ESLint, or in a custom script, when the rule needs:

- ESLint suggestions or autofix APIs that are already working.
- A codemod-backed repair path.
- Rich local `meta.docs` metadata unless you have moved that metadata to a
  Biome guidance registry.
- TypeScript parser services or semantic analysis that Biome does not expose
  to local plugins.
- A stable per-rule id for each local plugin diagnostic.
- Cross-file or project-specific checks that are easier to express with the
  current ESLint rule code.

Use `biome migrate eslint --write` and `biome migrate prettier --write` as
inventory tools on a branch, not as an automatic policy decision. The migration
command can identify many equivalent rules, but it will not preserve Musi's
custom guidance pipeline by itself.

## Verification Checklist

Before calling a Biome adapter production-ready:

- Pin `@biomejs/biome` and record the tested version.
- Add JSON reporter fixture tests for representative built-in diagnostics,
  parser errors, and Grit plugin diagnostics.
- Prove the post-edit hook on formatted, unformatted, unsupported, missing,
  and binary-file fixtures.
- Compare Biome safe-fix diffs against Prettier, ESLint autofix, and import
  sorting on representative edits.
- Run a latency sample for single-file post-edit, staged/changed, and full
  project commands.
- If ratcheting Biome diagnostics, test baseline update, regression,
  improvement, report, and summary modes.
- Keep the coverage map gate or an equivalent inventory so "Biome covers this"
  claims are checked against real tracked paths.
