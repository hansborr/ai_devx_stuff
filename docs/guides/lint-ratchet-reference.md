# Lint Ratchet Reference

This is the in-repo internals reference for the lint ratchet. Start with the
[Lint Ratchet](lint-ratchet.md) operator guide for the quickstart, command
reference, and baseline lifecycle; projects copying the runtime into another
codebase start with [Lint Ratchet Adoption](lint-ratchet-adoption.md).

This document covers the deeper mechanics an operator only reaches for
occasionally: the coverage-map gate, registry preflight and runtime internals,
CI parity wiring, metrics and baseline item shapes, baseline identity and
rule-source hashing, parser profiles, and advanced rollout patterns.

## Coverage Map Gate

The coverage map is the inventory companion to the ratchet. A ratchet entry
protects the files named by that one rule's `files` and `ignores`; it does not
prove that every maintained file family has a lint owner. The map records that
broader boundary in a committed Markdown table derived from `git ls-files`,
normal ESLint reach, and the current ratchet registry. Musi's current map lives
at `docs/generated/lint-coverage-map.md`.

`bun run docs:lint-coverage-map:check` validates map drift rather than style
(it mirrors the committing gate's behaviour — no ESLint-reach probe; see the
`:audit` split below):

- Every path code span in the path column must match at least one tracked file.
- Every `ratchet/<name>` in the ratchet column must exist in
  `scripts/lint-ratchet/lint-ratchet-config.ts`.
- Every status must be one of `linted`, `ratcheted`, `proposed`,
  `pending-leaf`, `excluded`, or `not-code`, combined with `+` when needed.
- Every tracked maintained file must be accounted for by some row. The Musi
  checker intentionally ignores generated/cache directories and only treats
  common code, config, script, docs, Prisma, SQL, and Dockerfile paths as
  coverage-map inputs.

The `--check-eslint-reach` flag adds the slow but important proof for rows
marked `linted`: each matched ESLint-managed tracked file must resolve an
ESLint config through `ESLint.calculateConfigForFile()`. That catches
ignore/unignore mistakes where a row says "normal lint owns this" but ESLint
would never run on the file. It is especially important when adopting local
rules, because a `local/*` rule can have metadata, tests, and even a ratchet
baseline while the target file family is still outside normal ESLint reach. The
reach check proves the prerequisite for a normal-lint claim; it does not inspect
every rule setting or replace targeted rule tests.

Staged and full modes have different jobs:

- Full mode reads the worktree map and should run with `--check-eslint-reach`
  in CI or full verification. In Musi, the dedicated `docs:lint-coverage-map:audit`
  package script bakes that flag in, and full `verify`/`verify:parallel` run the
  `:audit` form. The plain `docs:lint-coverage-map:check` script matches the
  committing gate (no reach probe) so a standalone pre-flight no longer reports
  reach gaps the `--staged` gate never trips.
- Staged mode reads the index copy of the map with `git show :<map-path>`, so
  pre-commit validates the map that will actually be committed. It deliberately
  skips ESLint reach, even when the package script also supplies
  `--check-eslint-reach`, so a hook invocation that includes both flags still
  treats `--staged` as the reach-skip mode. That keeps the parallel pre-commit
  gate fast and avoids mixing staged map content with slow worktree ESLint
  config resolution.

Adopters should copy the pattern, not the Musi paths verbatim:

- Keep a committed coverage map with the same table columns and status
  vocabulary, or adapt the parser with the map format.
- Copy `scripts/lint-coverage-map-check.ts` and
  `scripts/lint-coverage-map-check-eslint-reach.ts`, then update the map path,
  root path prefixes, tracked extensions, generated-directory exclusions, and
  ratchet-registry import for the adopting repository.
- Expose one full command that includes `--check-eslint-reach` (Musi's
  `:audit`), and wire that command into CI or full verification. Wire the
  pre-commit slot to the gate-default `:check` script plus `--staged` so the
  standalone pre-flight agrees with what pre-commit actually enforces.
- If the project lints non-ESLint surfaces such as shell, YAML, TOML, Prisma,
  SQL, or Markdown with other tools, keep those rows in the map but treat
  tool-specific reach checks as separate sensors or future extensions.

A small core-rule registry entry is the lowest-dependency starting point:

```ts
{
  id: "ratchet/core-no-debugger-src",
  ruleId: "no-debugger",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["src/**/*.ts", "src/**/*.tsx"],
  ignores: ["src/**/*.test.ts", "src/generated/**"],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  repairKind: "manual",
  principle: "Keep debugger statements from growing beyond the current debt.",
},
```

A local-rule ratchet uses the same shape, but its rule source defaults to
`local`:

```ts
{
  id: "ratchet/local-no-foo",
  ruleId: "local/no-foo",
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  repairKind: "manual",
  principle: "Keep forbidden placeholder calls from growing beyond the current debt.",
},
```

For that local example, `eslint.config.js` must expose
`plugins: { local: { rules: { "no-foo": noFoo } } }`, and
`eslint-rules/no-foo.js` must include a `meta.docs` object with `description`,
`principle`, `category`, `pairedGuide`, and `repairKind`; `pairedGuide` should
point at an existing guide path such as `docs/guides/local-eslint-rules.md`.

## Registry preflight and runtime internals

The runner expects normal package dependencies for ESLint,
`typescript-eslint`, `minimatch`, Zod, and any third-party plugin named by the
registry or allowlist. The current implementation assumes a classic
`node_modules` layout for package-version reads and cache storage. It resolves
ESLint's installed JavaScript entry and launches it with `process.execPath`,
reads ESLint and plugin versions from `node_modules/<package>/package.json`, and
writes generated config/cache files under
`node_modules/.cache/eslint-ratchet/`. Package-manager script aliases can change
freely, but Yarn PnP, global tool installs, and custom cache roots need runtime
changes.

Registry preflight, collection, and lifecycle checks are Git-tracked-file based.
They call `git ls-files`, then expand each ratchet with the shared
`ratchet-globs.ts` matcher before invoking ESLint with explicit paths. New
source files must be tracked before empty-glob, collection, coverage-map, and
zero-baseline checks can prove anything about them; untracked matching files are
not counted by the ratchet gate.

The ratchet runner writes isolated ESLint configs for each registry entry. It
does not reuse the project's full flat config and toggle one rule. Rules that
depend on project `settings`, globals, processors, import resolvers, or custom
TypeScript project setup need changes in `scripts/lint-ratchet/eslint-config.ts`
before they are reliable ratchet candidates. The registry preflight glob matcher
(`scripts/lint-ratchet/ratchet-globs.ts`) resolves `files`/`ignores` patterns
with minimatch and `{ dot: true }` — the same engine and option ESLint flat
config uses — so the gate selects exactly the file set ESLint would, dotfiles
included, with no hand-maintained supported-syntax subset to keep in sync.
Leading `!` negation is rejected by registry preflight because the ratchet
combines patterns as an unordered OR and cannot preserve ESLint's ordered
unignore semantics safely.

Local-rule scaffold is only needed for `local/*` ratchets:

- `eslint.config.js` must export a config array containing
  `plugins.local.rules`. The loader reads that object to discover
  `local/<rule-name>` metadata.
- Each ratcheted local rule needs an `eslint-rules/<rule-name>.js` source file.
  The runner hashes this exact file for `ruleSourceHash`.
- Each local rule's `meta.docs` must include `description`, `principle`,
  `category`, `pairedGuide`, and `repairKind`; `pairedGuide` should point at an
  existing guide path unless the project replaces `scripts/lib/lint-rule-docs.ts`
  with a reduced policy stub.

Projects that only ratchet core ESLint rules or third-party plugin rules can
skip `eslint.config.js` local-plugin wiring and `eslint-rules/` files by using
that reduced `scripts/lib/lint-rule-docs.ts` stub.

Two runtime knobs matter when tuning the collection:

- The `LINT_RATCHET_REPORT_ARTIFACT_URL` env var is part of the portable
  surface. The runner's single source of truth is the exported
  `LINT_RATCHET_REPORT_ARTIFACT_URL_ENV` constant in
  `scripts/lint-ratchet/report.ts`. If you rename it, update that constant and
  every workflow `env:` key that still exports the old literal name; otherwise
  the runner silently omits the `Artifact:` line.
- Default `lint:ratchet`, `lint:ratchet:update`, and
  `lint:ratchet:check-baseline` start by running the same registry preflight as
  `lint:ratchet:check-registry`, including `registry-shape`, `empty-glob`,
  `dead-glob` (a single `files` pattern that matches no tracked file, even when
  sibling patterns match — `allowEmpty` waives it), `absolute-path`, and
  harness-manifest failures. `lint:ratchet:update` skips only `orphan-baseline`
  preflight failures, because its update gate owns explicit orphan removal
  through `--allow-worse` or `--retire-ratchet`. Keep
  `lint:ratchet:check-registry` as a fast standalone setup/debug command when
  you want those labels without a full ESLint collection; CI does not need a
  separate visible step if `lint:ratchet` is already a gate.

## CI parity

CI parity matters when:

- Open-source projects take PRs from forks where local hooks cannot be enforced.
- Multi-repo teams have contributors running different local setups.
- In-house teams want a visible PR-time status check alongside the local
  pre-commit gate.

If you install the semantic merge driver, a blocking `lint:ratchet` or
`lint:ratchet:check-baseline` CI gate is required. Driver installation and
post-merge truth-up are intentionally advisory so dependency installation and
local Git operations stay recoverable; without an equivalent blocking gate, a
stale driver result or kept-ours fallback can land without validation.

The minimum CI setup runs the ratchet, audits zero-baseline lifecycle metadata,
and always uploads the diagnostics envelope. Swap `bun` for the adopter's
package manager if needed:

```yaml
- name: Lint ratchet
  env:
    HARNESS_DIAGNOSTICS_OUTPUT: lint-ratchet-diagnostics.json
  run: bun run lint:ratchet
- name: Lint ratchet zero-baseline lifecycle
  run: bun run lint:ratchet:zero-baseline
- name: Upload lint-ratchet diagnostics
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: lint-ratchet-diagnostics
    path: lint-ratchet-diagnostics.json
    retention-days: 7
```

Default `lint:ratchet` runs registry preflight before collecting ESLint
findings, then compares the current findings to the committed baseline and
emits the diagnostics envelope. That keeps missing local-rule files, empty
globs, absolute paths, orphan baseline ids, regressions, and uncommitted
improvements behind one semantic CI gate. See `.github/workflows/ci.yml` in
this repository for the worked example.

CI should not run `lint:ratchet:update` automatically:

- `lint:ratchet:update` rewrites the committed baseline. Running it in CI would
  either require commit-time write access, which is fragile and easy to misuse,
  or lower the committed floor based on an adversarial PR's choice of files.
- Any baseline update belongs in a local developer run so the baseline diff is
  reviewable in the PR.

For a failed CI run:

- The step summary (`$GITHUB_STEP_SUMMARY`) carries the per-control breakdown.
- The uploaded `lint-ratchet-diagnostics.json` artifact carries the full
  envelope with `path`, `ruleId`, `why`, and `howToFix` for every finding.
- If the current tree is better than the committed baseline, recover with
  `bun run lint:ratchet:update`, then commit and re-push the tighter baseline.
- If the current tree is worse than the committed baseline, fix the new
  findings. For intentional accepted debt, run:

  ```sh
  bun run lint:ratchet:update -- --allow-worse \
    --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"
  ```

  Capture the rationale in the commit message.

Avoid hand-written path filters on the ratchet workflow:

- The safe default is no path filter — run the ratchet workflow on every PR and
  push.
- Filtering is fragile because a ratchet's scope often spans more files than
  the immediate diff. A rename, config change, baseline edit, runtime helper
  change, or parser project change can change ratchet outputs without touching
  the files matched by a narrow source filter.
- If an adopter still insists on path filters, the required trigger union must
  cover the registry source globs themselves, meaning every `files` glob from
  every `ratchet/*` entry; the dynamically expanded ratchet runtime set
  described under the manifest's `runtimeFiles`/`expandDirectories` in
  [Lint Ratchet Adoption](lint-ratchet-adoption.md#what-to-copy); and
  per-project control inputs that change ratchet identity, including
  `eslint.config.js` and any included config files, the registry source file
  such as `scripts/lint-ratchet/lint-ratchet-config.ts`, `eslint-rules/**` for
  local-rule projects, dependency manifests (`package.json` plus the lockfile),
  and parser project configs the runner consults such as `tsconfig.scripts.json`
  or equivalent project-service tsconfigs.
- Because that union is so broad, hand-maintaining it tends to drift; in
  practice, no-filter is the only durable option.

See `.github/workflows/ci.yml` in this repository for the worked Musi workflow
with pinned action SHAs, a formatter-backed step summary, a sticky PR comment,
and the strict-improvement gate described in the operator guide's
[Commands](lint-ratchet.md#commands) in effect.

The diagnostics envelope is already captured to a file by the artifact plumbing
above. To render it for reviewers, pipe that file through
`bun run lint:ratchet:report` and append the result to `$GITHUB_STEP_SUMMARY`.
Pass the uploaded artifact URL through `LINT_RATCHET_REPORT_ARTIFACT_URL` when
available; the formatter adds an `Artifact: <url>` line above the recovery
footer.

A best-effort sticky PR comment is the second leg of the pattern. The comment
is anchored on the formatter's `<!-- lint-ratchet-summary -->` marker, so
re-running the workflow updates the same comment in place instead of stacking
new ones. Use `gh api --paginate` when searching for the existing marker:
without pagination, PRs with many comments can hide the marker on a later page
and get a fresh comment every run. Gate the step on `!cancelled()` rather than
`always()` so a canceled run can never overwrite a newer run's comment. Skip
silently on fork PRs, where the workflow lacks `pull-requests: write`, and set
job-level `permissions: pull-requests: write` so same-repo PR comments can
succeed.

Short sketch of the comment step:

```yaml
- name: Sticky PR comment for lint-ratchet report
  if: >-
    ${{ !cancelled() &&
        github.event_name == 'pull_request' &&
        github.event.pull_request.head.repo.full_name == github.repository }}
  env:
    GH_TOKEN: ${{ github.token }}
    LINT_RATCHET_REPORT_ARTIFACT_URL: ${{ steps.lint-ratchet-artifact.outputs.artifact-url }}
  run: |
    bun run lint:ratchet:report < lint-ratchet-diagnostics.json > lint-ratchet-report.md
    comments="repos/${{ github.repository }}/issues/${{ github.event.pull_request.number }}/comments"
    # --paginate runs --jq once per page, so avoid a `// ""` default (it emits an
    # empty line per non-matching page and gives the id embedded newlines on
    # multi-page PRs). Emit only real matches, then take the first non-empty id.
    matching_ids="$(
      gh api --paginate "$comments" \
        --jq '.[] | select(.body | contains("<!-- lint-ratchet-summary -->")) | .id'
    )"
    existing_id="$(printf '%s\n' "$matching_ids" | grep -m1 . || true)"
    post_comment() {
      if [ -n "$existing_id" ]; then
        gh api --method PATCH "repos/${{ github.repository }}/issues/comments/$existing_id" --field body=@lint-ratchet-report.md
      else
        gh api --method POST "$comments" --field body=@lint-ratchet-report.md
      fi
    }
    if ! post_comment; then
      echo "::warning::failed to post sticky PR comment"
      exit 0
    fi
```

This is only the wiring shape; see `.github/workflows/ci.yml` for the worked
example.

## Metrics and baseline items

Registry entries choose one metric. Default and check-baseline modes compare
that metric to the committed item for exact agreement: higher values are
regressions, lower values are improvements, and either direction must be handled
through the commands in the operator guide.

- `message-count` stores per-file `{ "count": N }` plus an optional
  `messagesFingerprint` on newly generated baselines. The diagnostic count is
  the gating compared value. The fingerprint is the SHA-256 of the sorted
  `messageId`-or-message list for that file. A finding with `messageId` uses only
  that stable id; otherwise the collector normalizes tool messages that embed
  the repository's absolute path or a location-anchored code frame before
  hashing. When the count is unchanged but the fingerprint differs,
  `lint:ratchet` emits an informational finding instead of failing. Message text
  can change across rule or plugin upgrades, and that is intentionally visible
  as finding-set churn to review before refreshing the baseline.
- `effective-line-count` is reserved for `local/max-lines`. It stores
  `{ "count": 1, "lines": N }` for each over-limit file. The count comparison
  catches added or removed over-limit files, while `lines` catches an
  already-over-limit file getting longer or shorter even though ESLint still
  emits only one diagnostic for that file.
- `complexity-severity` is reserved for core ESLint `complexity` ratchets. It
  stores `{ "count": N, "maxComplexity": N, "perFunction": [...] }` per file.
  The count comparison catches added or removed over-complex functions.
  `maxComplexity` and the sorted descending per-function complexity vector catch
  an already-covered function or file getting more or less complex while the
  diagnostic count is unchanged.

The runner reads the `local/max-lines` effective count from the rule's own
interpolated message (`This file has <N> effective lines...`) instead of
reimplementing the rule's blank-line/comment logic. If that message shape
changes, the ratchet fails loudly and the rule-source hash also forces a
baseline review.
For `complexity-severity`, the runner reads the core rule's interpolated
message (`Function '<name>' has a complexity of <N>...`) plus ESLint's
diagnostic line; it does not reimplement ESLint's cyclomatic complexity visitor.
(ESLint 10 removed `LintMessage#nodeType`, so per-function identity keys on the
line and the parsed label only.)

Default and check-baseline modes require metric-specific fields. For a converted
`effective-line-count` or `complexity-severity` ratchet, a count-only committed
item is a schema mismatch.
`update` mode uses structural parsing so one-shot migrations can rewrite old
count-only entries, but it still refuses any generated count, `lines`, max
complexity, or complexity-vector regression unless `--allow-worse --reason` is
supplied with a real rationale. The command template shows the placeholder
`"<why accepting this baseline increase is better than forcing a low-quality fix now>"`;
replace it before running the update.

## Baseline identity

Each baseline test stores both a `configHash` (covering the ratchet's `files`,
`ignores`, `ruleOptions`, mode, metric, and any non-default source/parser
profile identity) and a `ruleSourceHash`. The `ruleSourceHash`
covers the rule's own source plus the installed versions of the directly named,
top-level tools and packages described below. It does not hash the lockfile or
transitive dependency closure, so a transitive-only change that leaves those
top-level versions constant does not invalidate the cached findings:

- **Local rules.** SHA-256 of the rule's source closure (the matching
  `eslint-rules/<name>.js` plus its deterministically ordered relative-import
  closure, so helper-only edits also invalidate the ratchet cache), plus the
  installed ESLint and typescript-eslint versions (every generated config parses
  with `tseslint.parser`), plus the versions of any bare npm packages the
  closure imports.
- **Third-party rules.** SHA-256 of the allowlisted plugin identity — plugin
  package name, package version from `node_modules/<package>/package.json`,
  plugin export mode, and rule namespace — plus the installed ESLint and
  typescript-eslint (parser) versions, and, for `type-aware-ts` ratchets, the
  installed TypeScript version.
- **Core ESLint rules.** SHA-256 of the core rule identity: the rule id, rule
  options, installed ESLint version, and installed typescript-eslint parser
  version.

Deliberately uncovered (documented gaps, not oversights):

- **tsconfig contents.** Type-aware ratchets resolve findings against a tsconfig
  (and `projectService: true` makes the resolved-input set unbounded), so
  hashing tsconfig contents would be false precision. A tsconfig `lib`/`strict`
  edit shifts type-aware findings without drift classification and surfaces as a
  plain gate failure that `bun run lint:ratchet:update` clears.
- **The TypeScript compiler version for type-aware core rules.** Core configs
  fold in the typescript-eslint parser version, but a `type-aware-ts` core rule
  does not currently fold in the TypeScript compiler version. The live registry
  has no type-aware core ratchet.

Both stored hashes must use the exact `sha256:` plus 64 lowercase hexadecimal
digits shape; prefix-only or otherwise malformed hashes fail structural parsing,
including the semantic merge driver's strict input check.

The default and check-baseline gates run a strict parse that fails when either
hash drifts: edit the rule implementation, upgrade a ratcheted plugin or the
ESLint/typescript-eslint/TypeScript toolchain, or change the registry entry and
re-run `bun run lint:ratchet:update` to refresh both. The cache directory under `node_modules/.cache/eslint-ratchet/` is keyed
by generated ESLint config identity plus rule-source identity, so changes to
rule options, files, ignores, parser profile, local rule source, third-party
plugin version, or ESLint package version invalidate cached findings
automatically. Metric-only changes update the baseline identity but intentionally
do not churn generated ESLint config bytes or cache paths.

Baseline updates and generated ESLint configs use same-directory temporary files
plus atomic rename, so concurrent readers never observe a truncated artifact.
Content-addressed configs are reused only when their existing bytes match the
rendered config; a corrupt pre-existing file is replaced atomically. Concurrent
runs with different cache hashes can still race with stale-sibling sweeping, so
atomic writes narrow that separate cleanup window without eliminating it.

Default mode has one extra diagnostic path for stale `ruleSourceHash` entries:
when stale rule-source identity is the only strict-parse failure, it still
collects current findings against the structurally valid committed baseline.
The gate remains non-zero until `bun run lint:ratchet:update` refreshes the
hash, but the message distinguishes identity-only drift from upgrades that also
changed the finding set.

ESLint's per-file cache is only used for `minimal-ts` ratchets. `type-aware-ts`
ratchets intentionally omit `--cache` because ESLint's cache key follows direct
source bytes, not imported type dependencies; a schema type edit can otherwise
leave an unchanged consumer file with a stale clean result. The tradeoff is that
type-aware ratchets re-lint their full scope on every run, so cold and warm
runtime are expected to be similar.

Full collection runs isolated ratchet ESLint invocations through a bounded pool
with default concurrency 3. Set `AI_RATCHET_COLLECT_CONCURRENCY` to an integer
`>= 1` when a local or CI runner needs a different memory/runtime tradeoff.

Normal ESLint now uses ESLint's per-file cache for `bun run lint` and
`bun run lint:changed`, with `--cache-strategy content` under
`node_modules/.cache/eslint-main/identity-<fingerprint>/.eslintcache`. The
`<fingerprint>` hashes working-tree type-graph inputs (`*.ts`, `*.tsx`,
`*.mts`, `*.cts`, `tsconfig*.json/jsonc`, and `tsconfig.tsbuildinfo`, excluding
tool/cache dirs) plus lint-policy inputs (`eslint.config.*`,
`eslint-config/**`, and `eslint-rules/**/*.js`) plus dependency identity
(`package.json` and `bun.lock`, with `node_modules` pruned at any depth), so a
source type edit, local rule/config edit, package edit, or lockfile edit busts
the whole main lint cache even when an individual linted file's bytes are
unchanged. This keeps the cache sound for the normal flat config's type-aware
rules, local plugin rules, package-dir dependency rules, and plugin/parser
upgrades. `bun run lint:fix` remains uncached because it mutates files. Stale
`identity-*` cache directories are pruned when the current identity is selected.

The stale-clean failure that made the salt necessary was an unchanged consumer
switching exhaustively on an imported enum: after warming ESLint's cache, adding
a new enum member let cached lint pass while uncached lint correctly reported
`@typescript-eslint/switch-exhaustiveness-check`. The type-graph fingerprint
turns that imported-type drift into a new cache location instead of reusing stale
per-file results.

`update` mode uses a structural parse that tolerates stale or missing hashes
so it can re-baseline cleanly across registry edits, rule rewrites, and the
first run after strict-improvement metadata is introduced. Generated baseline
regressions are still rejected unless `--allow-worse --reason` is supplied with
a real rationale. The command template shows the placeholder
`"<why accepting this baseline increase is better than forcing a low-quality fix now>"`;
replace it before running the update.

## Rule sources and parser profiles

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
`lintRatchetThirdPartyPluginAllowlist` in `scripts/lint-ratchet/lint-ratchet-config.ts`
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
installed ESLint package version so upgrades invalidate cached findings.
Core `complexity` ratchets pair with the `complexity-severity` metric; the
registry currently has no core `complexity` entry (the top-level-scripts
ratchet was drained and retired), so the current core-sourced example is
`ratchet/no-real-time-in-package-tests` (`no-restricted-syntax`).

## Adoption patterns

Use ratchets when a useful lint rule cannot be enabled everywhere at once
without stopping unrelated work. The important sequence is the same in each
case: inventory the current findings, commit that count as the ceiling, prove
new findings fail, and then drain the baseline in smaller changes. A ratchet is
a monotone floor that keeps debt from growing and requires acknowledged cleanup:
after a drain, default and check-baseline gates will fail until
`bun run lint:ratchet:update` tightens the committed baseline. The first change
may be inventory plus floor plus baseline only, with cleanup deferred until a
later prioritized slice.

### Bringing an unlinted area under coverage

This is the path for scripts, codemods, generated-adjacent tooling, local ESLint
rules, shell hooks, config files, workflows, agent configs, devcontainer files,
or any other tracked maintained code/tooling that normal `bun run lint` does
not yet inspect.

1. Map the current coverage boundary. Identify which files are ignored by
   normal ESLint, which parser profile they need, and which fixture or generated
   paths must stay ignored. For broad coverage sweeps, commit a map artifact
   derived from `git ls-files`, checked against the actual ESLint
   ignore/unignore/parser config and current ratchet registry, and protect it
   with the [Coverage Map Gate](#coverage-map-gate). Keep that map in a durable
   project-doc location. Classify tracked maintained surfaces as normal lint,
   existing ratchet/floor, proposed floor, intentional exclusion, or named
   blocker/follow-up; do not start baselining batches while any temporary
   `unknown` classification remains.
   In Musi, maintained `scripts/**/*.ts` files are already normal-linted through
   `tsconfig.scripts.json`; new script fixtures should join the targeted
   fixture ignore list instead of reintroducing file-by-file script re-includes.
2. Run a scoped inventory with the rule set you want to enforce. Keep the
   inventory narrow enough that the first baseline is reviewable by file family
   or tool surface.
3. Add a ratchet entry in `scripts/lint-ratchet/lint-ratchet-config.ts` with explicit
   `files`, `ignores`, rule options, source, and parser profile. Prefer a
   family-level scope when the rule and parser needs are coherent; split by file
   or tool when the baseline would be too noisy. Avoid overlapping ratchets for
   the same rule/file pair; if multiple cleanup leaves share a tool family, one
   broader rule-specific ratchet with precise file membership is often clearer
   than sibling ratchets that must stay synchronized.
4. Run `bun run lint:ratchet:update` and review
   `lint-ratchet.baseline.json`. The initial baseline is the maximum allowed
   debt for that scope.
5. Run `bun run lint:ratchet`. For new source kinds or parser behavior, also
   add or update the focused ratchet smoke tests.
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
local enforcement that prevents unacknowledged drift from the committed floor.

### Adding a new rule to an already linted area

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
   as described in Rule sources and parser profiles.
4. Add the ratchet entry with the same rule options you plan to use for eventual
   normal ESLint enforcement.
5. Run `bun run lint:ratchet:update`, review the baseline, then run
   `bun run lint:ratchet`.
   For zero-finding scopes, use the same temporary-violation probe described
   above to prove the files are actually covered.
6. Drain the baseline in focused changes. Once the baseline is zero and the
   rule is no longer experimental for that scope, move it into the normal ESLint
   config for that scope or keep the ratchet only if staged rollout still needs
   separate ownership.

When adapting this setup to another project, preserve the three core pieces:
a registry of scoped rules, a committed per-file baseline, and a gate that
fails when counts or metrics diverge from the committed baseline without
acknowledgement. Increases require a fix or an explicit worse-baseline update;
decreases require a normal update that tightens the baseline. The exact parser
profiles, cache identity, and plugin allowlist can be simpler or stricter
depending on that project's lint surface.
