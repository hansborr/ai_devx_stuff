# Lint Ratchet

The lint ratchet tracks selected existing lint debt without allowing it to
grow. Normal `bun run lint` stays strict; `bun run lint:ratchet` is an
additional gate for rules that are being drained from a committed baseline.

For projects copying the ratchet to their own codebase, start with
[Lint Ratchet Adoption](lint-ratchet-adoption.md). It presents two adoption
tiers (minimal ratchet vs full platform), explains the runtime copy model, and
names the ongoing ownership cost. This guide is the full reference.

For projects adapting the ratchet to Biome diagnostics, see
[Biome Lint Adoption](biome-lint-adoption.md). The baseline and comparison
model are portable; the current runner and reach checks are ESLint-specific.

## First ratchet in 10 minutes

Start with one core ESLint rule and a small, real file scope. Copy the portable
runtime shape first:

- `scripts/lint-ratchet.ts`, the CLI entry point.
- Every non-test runtime module under `scripts/lint-ratchet/*.ts`; do not
  hand-list these files. The authoritative expansion is
  `PORTABLE_RUNTIME_FILES` in `scripts/tests/test-lint-ratchet.sh`, which
  dynamically adds the directory contents while excluding Vitest files.
- `scripts/lint-ratchet/lint-ratchet-config.ts`, the registry file an adopter
  edits for a real runner. A portable fixture may replace this file with its own
  minimal config instead of copying the repository registry.
- The cross-directory runtime dependencies named by `PORTABLE_RUNTIME_FILES`;
  for copy-and-run fixture tests, mirror the explicit `CROSS_DIR_RUNTIME_FILES`
  set in `scripts/lint-ratchet/lint-ratchet-output.test.ts`.
- `packages/shared/src/schemas/harness-diagnostics.ts`, or an equivalent local
  schema with the output, diagnostics, report, and test imports updated.
- `lint-ratchet.baseline.json`, initially `{ "version": 1, "tests": {} }`.

Add package scripts for `lint:ratchet:check-registry`,
`lint:ratchet:update`, and `lint:ratchet`, then put one raw entry in
`lintRatchets`:

```ts
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
```

Run the adoption commands in this order:

```sh
bun run lint:ratchet:check-registry
bun run lint:ratchet:update
bun run lint:ratchet
```

What happened: the registry check proved the id, rule source, globs, and
baseline references are structurally safe; the update generated the committed
per-file floor from today's findings; the final run proved the working tree
matches that floor. Future increases fail as regressions, and future decreases
fail as uncommitted improvements until `lint:ratchet:update` locks in the lower
baseline. Do not hand-edit the generated baseline after the starter JSON.

For the minimum copied test set, see [Test portability](#test-portability).

## Portable adoption

The design has three required pieces:

- A registry of scoped rules. Each `ratchet/<name>` entry names the ESLint
  rule, source kind, parser profile, file globs, ignore globs, options, mode,
  metric, and repair kind.
- A committed per-file baseline. `lint-ratchet.baseline.json` records each
  ratcheted file's current count or metric payload, plus config and rule-source
  hashes.
- A gate that fails on both sides of drift. Regressions fail because current
  findings are above the committed floor; un-reflected improvements also fail
  because current findings are below the baseline and must be locked in with
  `lint:ratchet:update`.

For local-rule and unlinted-area rollouts, add one recommended reference guard:
a committed coverage map protected by the
[Coverage Map Gate](#coverage-map-gate). The ratchet baseline proves selected
rules do not get worse; the map proves the project has accounted for every
tracked maintained surface and has not confused "planned", "ratcheted",
"normal-linted", and "intentionally excluded" coverage.

Minimum runtime file set:

- `scripts/lint-ratchet.ts` - CLI runner that loads the registry, hashes rule
  sources, writes generated ESLint configs, compares current findings to the
  baseline, and emits the diagnostics envelope.
- `scripts/lint-ratchet/lint-ratchet-config.ts` - registry types,
  third-party-plugin allowlist, and the `lintRatchets` entries an adopter
  edits.
- Every other non-test `scripts/lint-ratchet/*.ts` runtime module. This guide
  intentionally does not maintain that inventory by hand; the authoritative
  copy set is `PORTABLE_RUNTIME_FILES` in
  `scripts/tests/test-lint-ratchet.sh`, which dynamically expands
  `scripts/lint-ratchet/*.ts` and excludes `*.test.ts`.
- Cross-directory runtime dependencies from the same `PORTABLE_RUNTIME_FILES`
  array, such as local-rule helpers and ESLint JSON/report support files. When
  a portable test writes its own registry, follow the explicit
  `CROSS_DIR_RUNTIME_FILES` set plus `deriveLintRatchetRuntimeModules()` in
  `scripts/lint-ratchet/lint-ratchet-output.test.ts`; that fixture omits the
  repository registry/config file by design.
- `packages/shared/src/schemas/harness-diagnostics.ts` - Zod schema and summary
  helper for the runner's output envelope; copy it at this path or update the
  output, diagnostics, report, and copied-test imports to a project-local
  equivalent.
- `lint-ratchet.baseline.json` - committed generated baseline; a new setup can
  start with `{ "version": 1, "tests": {} }`, then `lint:ratchet:update`
  rewrites it from the current tree.

The runner also expects normal package dependencies for ESLint,
`typescript-eslint`, Zod, and any third-party plugin named by the registry or
allowlist. The current implementation assumes a classic `node_modules` layout:
it spawns `node_modules/.bin/eslint`, reads ESLint and plugin versions from
`node_modules/<package>/package.json`, and writes generated config/cache files
under `node_modules/.cache/eslint-ratchet/`. Package-manager script aliases can
change freely, but Yarn PnP, global tool installs, and custom cache roots need
runtime changes.

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
before they are reliable ratchet candidates. The built-in registry preflight
glob matcher intentionally supports only the simple relative glob forms used by
current ratchets (`*`, `**`, `?`, and brace alternatives); extend
`scripts/lint-ratchet/ratchet-globs.ts` before adopting broader minimatch
syntax.

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

Substitutable bits:

- Package manager: Musi uses `bun run lint:ratchet`, but the scripts can be
  exposed through `npm run`, `pnpm`, or another task runner. Expose
  `lint:ratchet:summary` with the portable surface so adopters can see baseline
  totals at a glance.
- Monorepo layout: `repoRoot`, package globs, and the
  `packages/shared/.../harness-diagnostics.ts` import can move with the
  adopting repository's layout.
- Cache location: generated configs and ESLint cache entries live under
  `node_modules/.cache/eslint-ratchet/`; change the path helpers if another
  cache root is preferred.
- Harness diagnostics shape: keep the schema if downstream tools consume the
  envelope, or replace it with a reduced schema and matching runner import.
- Local-rule metadata: the `meta.docs` vocabulary is a project policy, not an
  ESLint requirement; keep it, simplify it, or stub it out with
  `scripts/lib/lint-rule-docs.ts`.
- Local rules themselves: adopters do not need local rules to use the ratchet
  for core or third-party ESLint rules.
- Report artifact env var: `LINT_RATCHET_REPORT_ARTIFACT_URL` is part of the
  portable surface. The runner's single source of truth is the exported
  `LINT_RATCHET_REPORT_ARTIFACT_URL_ENV` constant in
  `scripts/lint-ratchet/lint-ratchet-report.ts`. If you rename it, update that constant and
  every workflow `env:` key that still exports the old literal name; otherwise
  the runner silently omits the `Artifact:` line.
- Registry preflight: default `lint:ratchet`, `lint:ratchet:update`, and
  `lint:ratchet:check-baseline` start by running the same registry preflight as
  `lint:ratchet:check-registry`, including `registry-shape`, `empty-glob`,
  `absolute-path`, and harness-manifest failures. `lint:ratchet:update` skips
  only `orphan-baseline` preflight failures, because its update gate owns
  explicit orphan removal through `--allow-worse` or `--retire-ratchet`. Keep
  `lint:ratchet:check-registry` as a fast standalone setup/debug command when
  you want those labels without a full ESLint collection; CI does not need a
  separate visible step if `lint:ratchet` is already a gate.

### Coverage Map Gate

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
  target: 0,
  metric: "message-count",
  repairKind: "manual",
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
  target: 0,
  metric: "message-count",
  repairKind: "manual",
},
```

For that local example, `eslint.config.js` must expose
`plugins: { local: { rules: { "no-foo": noFoo } } }`, and
`eslint-rules/no-foo.js` must include a `meta.docs` object with `description`,
`principle`, `category`, `pairedGuide`, and `repairKind`; `pairedGuide` should
point at an existing guide path such as `docs/guides/local-eslint-rules.md`.

### CI parity

CI parity matters when:

- Open-source projects take PRs from forks where local hooks cannot be enforced.
- Multi-repo teams have contributors running different local setups.
- In-house teams want a visible PR-time status check alongside the local
  pre-commit gate.

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
  described under `Minimum runtime file set` in
  [Portable adoption](#portable-adoption); and per-project control inputs that
  change ratchet identity, including `eslint.config.js` and
  any included config files, the registry source file such as
  `scripts/lint-ratchet/lint-ratchet-config.ts`, `eslint-rules/**` for local-rule projects,
  dependency manifests (`package.json` plus the lockfile), and parser project
  configs the runner consults such as `tsconfig.scripts.json` or equivalent
  project-service tsconfigs.
- Because that union is so broad, hand-maintaining it tends to drift; in
  practice, no-filter is the only durable option.

See `.github/workflows/ci.yml` in this repository for the worked Musi workflow
with pinned action SHAs, a formatter-backed step summary, a sticky PR comment,
and the strict-improvement gate described in [Commands](#commands) in effect.

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
    existing_id="$(
      gh api --paginate "$comments" \
        --jq '.[] | select(.body | contains("<!-- lint-ratchet-summary -->")) | .id' |
      tail -n 1
    )"
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

The rest of this guide covers advanced topics: parser profiles, third-party
plugin allowlisting, complexity-severity vectors, and rule-source hashing.

## Commands

- `bun run lint:ratchet` emits a `harness-diagnostics` envelope and fails when
  registry preflight fails or a ratcheted path diverges from the committed
  baseline in either direction: regressions above the floor, or improvements
  below the floor because the current findings are lower than the baseline.
  Improvements enter the envelope as blocking harness findings with the
  recovery command in `howToFix`. Registry entries with `mode: "report-only"`
  are collected during this run but never fail the gate: they emit one
  `info`-severity finding with the current total and are excluded from the
  committed baseline. `mode: "ratchet-down"` remains reserved.
- `bun run lint:ratchet -- --propose <ruleId> <glob...>` is a dry run for a
  candidate core ESLint rule or `local/<rule-name>` rule. It builds an ad-hoc
  single-entry ratchet in memory, filters the provided globs through the same
  Git-tracked-file matcher used by update/check mode, and prints the file
  count, total findings, top offending files, and would-be baseline JSON. Use
  repeatable `--ignore <glob>`, `--metric <message-count|effective-line-count|complexity-severity>`,
  and `--rule-options '<json-array>'` after the file globs to mirror the real
  registry entry before promoting it. The preview never edits
  `lint-ratchet-config.ts` or `lint-ratchet.baseline.json`; the printed
  `ratchet/propose` id plus `configHash` and `ruleSourceHash` are synthetic
  preview fields, so copy only the rule config fields into the registry and run
  `bun run lint:ratchet:update` for the real baseline. Third-party rules are
  intentionally deferred to a future `--plugin` option.
- `bun run lint:ratchet:check-registry` validates the ratchet registry, the
  `files`/`ignores` globs, and the committed baseline ids without running
  ESLint. In Musi, it also reads `harness.controls.json` when present and
  fails if a `ratchet/*` registry entry is missing a matching manifest control.
  It is the fast preflight an adopter runs after copying the files and writing
  one registry entry, before `bun run lint:ratchet:update` generates a
  baseline. On failure it prints adopter-friendly `<kind>: <message>` lines and
  exits non-zero, where `<kind>` includes `registry-shape`, `empty-glob`,
  `absolute-path`, `orphan-baseline`, and `missing-harness-ratchet`. Default
  `lint:ratchet`, `lint:ratchet:update`, and `lint:ratchet:check-baseline`
  invoke the same preflight before collection; update mode filters only
  `orphan-baseline` so the worse-baseline gate can account for intentional
  renames/removals. Keep this standalone command for setup/debug runs where you
  want the registry check without the ESLint pass. When
  `lint-ratchet.baseline.json` does not yet exist, the orphan-baseline check is
  a no-op, so the command remains useful before the first baseline is generated.
- `bun run lint:ratchet:check-baseline` validates that
  `lint-ratchet.baseline.json` is deterministic, still matches the ratchet
  registry, and enforces the same strict gate in both directions. It exits
  non-zero on regressions or improvements and names the affected paths. CI does
  not need this after `lint:ratchet`, because it repeats the same current
  collection and baseline comparison without the diagnostics envelope.
- `bun run lint:ratchet:check-debt-accounting` compares the current committed
  baseline to the merge-base version from `origin/main` (falling back to the
  first parent when needed). Any per-path baseline increase with the same
  ratchet `configHash` must have a same-range `lint-ratchet.debt-log.jsonl`
  regression entry for the same `(testId, path)`. This catches hand-edited
  baseline floors that would otherwise bypass `--allow-worse --reason`; initial
  ratchet adoption and config-scope changes are exempt because their floors are
  not comparable to the base snapshot.
- `bun run lint:ratchet:summary` reads the committed
  `lint-ratchet.baseline.json` and prints a per-ratchet table without running
  ESLint. It is informational only: it never fails on findings and never
  rewrites the baseline. The table columns are ratchet id, rule id, metric, file
  count, and total findings. Total findings sum the per-file `count` across
  files for every metric, so `complexity-severity` rows show the number of
  findings rather than a `maxComplexity` aggregate. Use it to spot which
  ratchets carry the most debt without diffing the committed baseline JSON by
  hand. Add `--by-directory [depth]` to group each ratchet's remaining findings
  by repo-relative directory prefix; the default depth is `3` (for example
  `packages/client/src`), and rows sort largest-first within each ratchet.
- `bun run lint:ratchet:trend` walks `git log` for
  `lint-ratchet.baseline.json`, structurally parses each historical baseline,
  and prints first/current/min/max finding totals per ratchet. It is
  informational only and never runs ESLint. Use `--since <date>` or `--max <n>`
  to narrow the history window. Historical baseline blobs that cannot be parsed
  are skipped with a warning instead of failing the command; ratchet id renames
  appear as one series ending and another starting.
- `bun run lint:ratchet:zero-baseline` reads the committed baseline, finds
  ratchets with zero findings, expands their registry globs against
  `git ls-files`, and compares the same rule/options against normal ESLint's
  resolved config for each matched file. The report classifies each drained
  ratchet as normal-lint `error`, `warn`, `off`, `ignored`, `mixed`, or
  different-options coverage, then names the lifecycle action to take. The
  command exits non-zero when any zero-baseline ratchet lacks
  `zeroBaselineDisposition`; add disposition metadata, promote and remove the
  ratchet, or update the committed baseline after narrowing the ratchet.
- `bun run lint:ratchet:report` reads a `harness-diagnostics` envelope from
  stdin; the typical flow is
  `bun run lint:ratchet:report < lint-ratchet-diagnostics.json`. It emits
  GitHub-flavored markdown suitable for `$GITHUB_STEP_SUMMARY` and PR comments,
  and is informational only: it never fails on findings. The output starts with
  the sticky-comment marker `<!-- lint-ratchet-summary -->` so CI can find and
  update a previous sticky comment in place. The recovery footer is state-aware:
  improvement-only envelopes name `bun run lint:ratchet:update`;
  regression-only envelopes name the `--allow-worse --reason` form; and empty
  envelopes say "nothing to do". Per-control finding lists are capped at 10
  with an `_<n> more in artifact._` italic line so a noisy ratchet does not
  drown the comment. Setting `LINT_RATCHET_REPORT_ARTIFACT_URL` adds an
  `Artifact: <url>` line above the recovery footer, which CI uses to link the
  uploaded diagnostics artifact.
- `bun run lint:ratchet:update` is the recovery for an improvement failure: it
  rewrites the baseline from the current tree to the tighter counts and metrics.
  It runs registry preflight before rewriting and fails on broken/empty globs,
  absolute paths, or missing harness controls; only orphan-baseline preflight
  failures are deferred to update's own accounting path. No `--allow-worse` flag
  is needed because lowering the baseline is not worsening it. Report-only
  ratchets are intentionally omitted from generated baselines; promote them to
  `mode: "no-new"` before running update when the current inventory should
  become a committed floor. If a rename or intentional policy change makes the
  generated baseline worse, use:

  ```sh
  bun run lint:ratchet:update -- --allow-worse \
    --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"
  ```

  The `--reason` text is durably recorded as the `acceptanceReason` field of a new line in the
  committed debt log `lint-ratchet.debt-log.jsonl` (see the next bullet), so the
  rationale outlives the commit message. The update records that line immediately
  before rewriting the baseline and treats the same line already present at the
  debt-log tail as a retry, so stage and commit `lint-ratchet.debt-log.jsonl`
  alongside `lint-ratchet.baseline.json` — a human commits the paired diff.
  Retiring a *zero-finding* ratchet whose rule was promoted into normal lint is a
  strict improvement, not accepted debt, so it must not go through `--allow-worse`.
  Use `bun run lint:ratchet:update -- --retire-ratchet <id>` instead (see the
  [Zero-Baseline Lifecycle](#zero-baseline-lifecycle)): it drops the orphaned floor
  without a debt-log entry, but only after proving normal lint now errors on the
  retired scope — a zero baseline alone never proves the guard was replaced. The
  flag is mutually exclusive with `--allow-worse`.
- `bun run lint:ratchet:debt-log` renders the committed debt log as
  GitHub-flavored markdown (sticky-comment marker `<!-- lint-ratchet-debt-log -->`,
  one section per acceptance, oldest first). It is read-only and never fails: on a
  clean tree with no recorded acceptances it prints an empty report and exits 0.
  Only *worse* acceptances are logged — the `--allow-worse` regression set plus
  orphan (renamed/removed registry id) removals with the committed baseline
  snapshot that is being dropped; routine tightening updates, improvement locks,
  and proven `--retire-ratchet` retirements write nothing, and a first-ever
  baseline (initial adoption) logs nothing because there is no committed baseline
  to compare against. Each line deliberately omits
  timestamp, branch, parent commit, committer, and baseline hashes: PR reviewers
  derive those from the commit, blame, and the `lint-ratchet.baseline.json` diff,
  so the log stays a minimal, human-reviewable record of *why* debt was accepted.
  The renderer stays read-only and never auto-commits. Debt-log accounting is
  enforced by CI and full `verify` through `lint:ratchet:check-debt-accounting`;
  staging and committing the paired log entry remains a deliberate human step.

Strict improvement enforcement is the default. The ratchet is symmetric: neither
a regression nor an improvement may diverge from the committed baseline without
explicit acknowledgement. Regressions require fixing the new or worse findings,
or updating with `--allow-worse`; improvements require
`bun run lint:ratchet:update` so the committed floor moves down monotonically.

## Merge Conflicts

Both committed ratchet files declare explicit merge semantics in
`.gitattributes`, because their correct merge behavior is opposite:

- `/lint-ratchet.debt-log.jsonl merge=union` — the log is append-only JSONL
  where every line is an independent record, so a union merge that keeps both
  sides' lines is always correct. The relative order of the two sides'
  appended entries is arbitrary; nothing reads the log positionally.
- `/lint-ratchet.baseline.json merge=lint-ratchet-baseline` — the baseline is
  derived from the source tree, so no textual merge of two baselines is ever
  correct. The custom driver first attempts a three-way semantic merge. It
  keeps one-sided ratchet entry changes from either side, and when both sides
  changed the same ratchet entry with matching metadata it takes the lower
  per-path floor while treating a missing path as fully drained. If that
  semantic merge cannot resolve safely, the driver falls back to the manual
  resolution recipe, keeps the 'ours' side in the working tree (still valid
  JSON, never conflict markers), and declares a conflict.

Both patterns are anchored to the repo root so a same-named fixture committed
under a test directory never picks up these merge semantics. The driver fires
for every operation that uses the merge machinery, not just `git merge`. The
semantic merge rules are symmetric in the two sides, so rebase side-swapping
does not matter when the driver resolves automatically. The side-swap warning
still matters on fallback: during `git merge` and `git cherry-pick` the kept
'ours' side is the current branch, but during `git rebase` the sides are
swapped — the kept version is the upstream base, not the branch being rebased.

The repo installs the local driver config automatically from `prepare`, the
checkout/merge hooks, and `worktree:init`. Run the installer manually as the
recovery path if a clone predates that automation, package scripts were skipped,
or a health check reports stale local merge-driver state:

```sh
bun run lint:ratchet:install-merge-driver
```

Git does not load merge-driver commands from committed files; `.gitattributes`
only names the driver. The install script copies the driver into the clone's
Git common directory, writes `merge.lint-ratchet-baseline.*` to local Git
config, and mirrors the ratchet attributes into `.git/info/attributes`,
replacing stale local `lint-ratchet.baseline.json -merge` entries from the
transition window. The installed command resolves the Git common directory at
merge time, so linked worktrees do not keep pointing at whichever checkout ran
the installer.

Automatic installation follows the existing Husky `prepare` precedent for
local Git config writes: it is idempotent, silent when the installed driver,
config entries, and info-attributes block are already current, and degrades to a
warning rather than breaking dependency install. The checkout and merge hooks
rerun the same cheap check so pulling driver or attribute changes refreshes
local state before the next merge operation.

After a completed merge touches `lint-ratchet.baseline.json`, the post-merge
hook runs a cheap baseline truth-up and escalates to
`bun run lint:ratchet:check-baseline` when preflight fails, when the semantic
merge driver left a strict-min truth-up marker, or when
`MUSI_RATCHET_POSTMERGE=full` is set. If that local advisory is skipped or
misses a bad merge result, CI remains the blocking backstop: pull requests and
pushes to `main` run `bun run lint:ratchet` and
`bun run lint:ratchet:zero-baseline`.

When the semantic merge succeeds, Git uses the merged baseline and continues.
The post-merge truth-up is the local backstop for the strict-min case where the
merged source tree is actually worse than the lower floor the driver preserved;
run `bun run lint:ratchet:update` and amend the merge if the hook reports a
stale or invalid baseline.

When the driver falls back and creates a baseline conflict, never hand-edit the
file. The kept version is only a placeholder; the real resolution is
regeneration against the merged tree. The driver prints this same recipe when
the conflict is created:

<!-- lint-ratchet-baseline-conflict-recipe:start -->
```text
lint-ratchet baseline conflict: lint-ratchet.baseline.json is generated, so do not hand-merge it.
Git kept the 'ours' side in the working tree so the JSON stays parseable.
That is the current branch during git merge and git cherry-pick.
During git rebase the sides are swapped: the kept version is the upstream
base, not the branch being rebased.

Resolve every other conflict first, then run:
  bun run lint:ratchet:update

Then inspect the baseline diff against both sides:
  git diff HEAD -- lint-ratchet.baseline.json
  git diff MERGE_HEAD -- lint-ratchet.baseline.json

MERGE_HEAD exists only during git merge; use REBASE_HEAD during a rebase or
CHERRY_PICK_HEAD during a cherry-pick.

If the other side had lower floors, preserve them before adding the baseline
or explicitly accept the regression in the merge review.

Then run:
  git add lint-ratchet.baseline.json

If update asks for --allow-worse, the merged code regressed past the kept floor.
Fix the findings, or accept the debt with:
  bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"
```
<!-- lint-ratchet-baseline-conflict-recipe:end -->

Accepting the debt appends the acceptance to the union-merged debt log.

If a baseline conflict contains `<<<<<<<` markers or Git did not print the
driver guidance, the clone is missing the local driver config or has stale
`.git/info/attributes`. Run `bun run lint:ratchet:install-merge-driver`, restore
the 'ours' baseline placeholder
(`git checkout --ours -- lint-ratchet.baseline.json`), then continue the recipe
above.

On fallback, keeping only the 'ours' side discards the other side's floors
before regeneration, so the update command compares only against the kept side.
That is why the both-sides baseline diff check above is part of the required
conflict recipe: when both sides locked improvements, reviewers need to confirm
the merged code preserved them or that any loss was intentional.

Merge attributes are read from the tree that is checked out, not from the
branch being merged in, so branches created before the `.gitattributes`
entries existed do not honor them when merged *into*. The install script's
`.git/info/attributes` mirror applies to every operation in the clone regardless
of checkout, as long as the installer has been run after the relevant merge
attribute changes landed.

## Zero-Baseline Lifecycle

A ratchet reaching zero is not the end of the lifecycle. It is a decision point:
the project must either promote the rule into the normal lint floor, narrow the
floor, or document why a zero ratchet is still intentionally separate.

Default to promotion:

1. Run `bun run lint:ratchet:summary` and confirm the ratchet has zero
   findings.
2. Run `bun run lint:ratchet:zero-baseline` and inspect the row for that
   ratchet.
3. If normal ESLint already reports the same rule/options as `error` on the
   same effective file set, remove the ratchet entry and run
   `bun run lint:ratchet:update -- --retire-ratchet <id>`. This is a clean
   retirement, not accepted debt: the updater drops the now-orphaned zero-finding
   floor without `--allow-worse` and without a `lint-ratchet.debt-log.jsonl`
   entry, and prints `Retired ratchet <id> ... No debt logged.`. A zero baseline
   alone is not enough — the updater first re-runs the normal-lint coverage probe
   and only retires when normal lint still errors on the retired scope. If that
   proof fails (the rule was dropped without a replacement, or only some files
   are covered), the command refuses and tells you to accept the removal as debt
   with `--allow-worse --reason "<...>"` instead. Retirement and `--allow-worse`
   are mutually exclusive: one promotes a proven guard, the other logs accepted
   debt.
4. If normal ESLint is `off`, `warn`, ignored, mixed, or uses different options,
   promote the matching rule/options to normal ESLint at `error` before removing
   the ratchet. Until promotion is proven, `--retire-ratchet` refuses and the
   removal must go through `--allow-worse --reason "<...>"`.

Normal-lint `warn` is not fully promoted. `bun run lint` and
`bun run lint:changed` use `--max-warnings=0`, but the post-edit tidy hook runs
per-file `eslint --fix --no-warn-ignored`; a warning can be missed in the edit
loop. Use `error` for drained ratchets that represent permanent policy. See
[Local ESLint Rules](local-eslint-rules.md#severity-semantics) for the broader
normal-ESLint versus agent-envelope severity convention.

Leaving a zero ratchet in the registry is acceptable only when one of these
cases applies:

- `temporary-ratchet-only`: normal ESLint re-inclusion is blocked by unrelated
  rule noise, parser/project setup, or a named adoption leaf. Record the
  blocker and `exitPath`.
- `intentional-ratchet-only`: the file family is deliberately outside normal
  ESLint, but still maintained enough to need this floor. Record why normal
  lint is not the owner.
- `narrow-floor`: the ratchet is intentionally narrower, faster, or differently
  scoped than normal lint; record what invariant the narrower floor protects.
- `promote-to-normal-lint`: promotion is the chosen outcome, but it is tracked
  as a follow-up rather than completed in the current change. Record the
  `exitPath`.

Use the registry's optional `zeroBaselineDisposition` field for these cases:

```ts
{
  id: "ratchet/example",
  ruleId: "example/rule",
  // ...
  zeroBaselineDisposition: {
    kind: "temporary-ratchet-only",
    reason: "normal ESLint still ignores this generated-adjacent tool family",
    exitPath: "docs/agent_notes/backlog/example-pack/example.md",
  },
}
```

`bun run lint:ratchet:zero-baseline` is a gate, not just a report. Every
zero-baseline ratchet must either carry `zeroBaselineDisposition` or be removed
after promotion or narrowing work updates the committed baseline. Normal-lint
`error` coverage is useful evidence for removal, but it is not by itself
durable lifecycle documentation.

For files ignored by normal ESLint, do not blindly unignore the whole tree.
Record the intended parser profile, fixture/generated exclusions, and any
unrelated findings that would appear after re-inclusion. A zero-baseline probe
still matters: temporarily introduce one in-scope violation, prove
`lint:ratchet` catches it, revert the probe, then decide whether promotion or a
documented ratchet-only disposition is the right next step.

The post-edit tidy hook should remain ratchet-free. It is a fast mechanical
formatter/autofix hook, not a policy gate. Immediate feedback for drained
ratchets should come from normal ESLint promotion; `lint:ratchet` remains the
pre-commit and verification floor until the ratchet is retired.

## Metrics and baseline items

Registry entries choose one metric. Default and check-baseline modes compare
that metric to the committed item for exact agreement: higher values are
regressions, lower values are improvements, and either direction must be handled
through the commands above.

- `message-count` stores per-file `{ "count": N }` plus an optional
  `messagesFingerprint` on newly generated baselines. The diagnostic count is
  the gating compared value. The fingerprint is the SHA-256 of the sorted
  `messageId`-or-message list for that file, excluding line numbers; when the
  count is unchanged but the fingerprint differs, `lint:ratchet` emits an
  informational finding instead of failing. Message text can change across rule
  or plugin upgrades, and that is intentionally visible as finding-set churn to
  review before refreshing the baseline.
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

## Current ratchets

The active ratchet registry is the exported `lintRatchets` array in
`scripts/lint-ratchet/lint-ratchet-config.ts`. Run
`bun run lint:ratchet:summary` for the current ids, rules, metrics, file
counts, and finding totals. This guide intentionally does not hand-copy the
registry, because the committed list changes more often than the operating
model.

Path renames move baseline keys. A rename that keeps or lowers the count should
update the baseline in the same commit. A rename that also increases the count
needs the explicit `--allow-worse --reason` path.

## Baseline identity

Each baseline test stores both a `configHash` (covering the ratchet's `files`,
`ignores`, `ruleOptions`, mode, metric, target, and any non-default
source/parser profile identity) and a `ruleSourceHash`. For local rules,
`ruleSourceHash` is the SHA-256 of the matching `eslint-rules/<name>.js` when
the rule has no relative helper imports; helper-importing rules hash the
deterministically ordered relative-import closure so helper-only edits also
invalidate the ratchet cache. For third-party rules, it is the SHA-256 of the
allowlisted plugin identity,
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
Current core `complexity` ratchets use `complexity-severity`, including the
top-level-scripts ratchet.

## Adding a ratchet

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
explicit third-party source and parser profile. The third-party/type-aware
infrastructure was added after the original local-rule runner and was first
used for a strict-boolean-expressions ratchet.

Core ESLint rules such as `complexity`, `max-params`, and
`no-nested-ternary` use the explicit core source shape described above and a
bare built-in rule id.

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

## Test portability

The minimum portable ratchet test set is the fixture-driven runtime behavior,
the fixture-driven summary behavior, the copied-runtime smoke test, and the
portable registry-validation failure cases. In this repository, those live in:

- `scripts/lint-ratchet/lint-ratchet-baseline.test.ts`: portable. It exercises baseline
  building, strict and structural parsing, comparison, update decisions,
  diagnostics-envelope formatting, rule-source hashes, and registry validation
  with fixture ratchet configs and synthetic paths. The `packages/...` strings
  are baseline keys, not dependencies on Musi app files.
- `scripts/lint-ratchet/lint-ratchet-summary.test.ts`: portable. It builds fixture
  baselines and registry entries to verify summary reduction and table
  formatting.
- `scripts/lint-ratchet/lint-ratchet-output.test.ts`: portable. It copies the CLI runtime
  files into a temporary fixture repository, writes a small core-rule registry,
  runs the CLI there, and verifies `HARNESS_DIAGNOSTICS_OUTPUT` behavior without
  Musi app state. Its runtime file set is
  `CROSS_DIR_RUNTIME_FILES` plus `deriveLintRatchetRuntimeModules()`, so only
  the cross-directory files are explicit; `scripts/lint-ratchet/*.ts` modules
  are derived dynamically, and the repository registry/config file is omitted
  because the fixture writes its own.
- `scripts/lint-ratchet/lint-ratchet-check-registry.test.ts`: mixed. The portable cases are
  the synthetic failure-mode tests for empty globs, absolute paths, orphan
  baseline ids, zero-baseline metadata shape, deterministic failure ordering,
  and absent-baseline behavior. The `accepts the Musi registry fixture` case is
  Musi-only because it loads this repository's `lintRatchets`,
  third-party-plugin allowlist, local-rule docs, and tracked Git files.

An adopter should copy the three fully portable files and either copy
`scripts/lint-ratchet/lint-ratchet-check-registry.test.ts` with the Musi registry fixture
case replaced by an equivalent project-local registry smoke test, or keep only
the portable synthetic cases from that file. Musi verifies the current split
with `bun run test:scripts:changed`.
