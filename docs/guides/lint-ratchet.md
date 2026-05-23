# Lint Ratchet

The lint ratchet tracks selected existing lint debt without allowing it to
grow. Normal `bun run lint` stays strict; `bun run lint:ratchet` is an
additional gate for rules that are being drained from a committed baseline.

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

Minimum runtime file set:

- `scripts/lint-ratchet.ts` - CLI runner that loads the registry, hashes rule
  sources, writes generated ESLint configs, compares current findings to the
  baseline, and emits the diagnostics envelope.
- `scripts/lint-ratchet-baseline.ts` - baseline model, config hashing,
  rule-source hashing helpers, strict parse/format validation, and update
  safety checks.
- `scripts/lint-ratchet-baseline-compare.ts` - comparator that turns current
  findings into regressions or improvements against the committed baseline.
- `scripts/lint-ratchet-baseline-parse.ts` - structural and strict parser for
  `lint-ratchet.baseline.json`.
- `scripts/lint-ratchet-check-registry.ts` - sibling helper that composes
  existing registry, glob, and baseline-parse helpers into a fast preflight
  validator with no ESLint run; it labels failures by kind for
  adopter-friendly error messages.
- `scripts/lint-ratchet-config.ts` - registry types, third-party plugin
  allowlist, and the `lintRatchets` entries an adopter edits.
- `scripts/lint-ratchet-metrics.ts` - metric helpers for `message-count`,
  `effective-line-count`, and `complexity-severity`.
- `scripts/lint-ratchet-output.ts` - harness diagnostics envelope output helper
  that writes to stdout and, when `HARNESS_DIAGNOSTICS_OUTPUT` is set to a
  non-empty path, also to that file; without it, the runner fails to start.
- `scripts/lint-ratchet-report.ts` - sibling helper that formats a captured
  harness-diagnostics envelope as a GitHub-flavored markdown report; it owns
  the `LINT_RATCHET_REPORT_ARTIFACT_URL` env-var contract.
- `scripts/lint-ratchet-summary.ts` - sibling helper that prints a per-ratchet
  baseline summary table without running ESLint.
- `scripts/lint-rule-docs.ts` - local-rule metadata loader used for `local/*`
  ratchets; replace it with a same-export stub if the project only ratchets
  core or third-party rules.
- `packages/shared/src/schemas/harness-diagnostics.ts` - Zod schema and summary
  helper for the runner's output envelope; copy it at this path or update the
  runner import to a project-local equivalent.
- `lint-ratchet.baseline.json` - committed generated baseline; a new setup can
  start with `{ "version": 1, "tests": {} }`, then `lint:ratchet:update`
  rewrites it from the current tree.

The runner also expects normal package dependencies for ESLint,
`typescript-eslint`, Zod, and any third-party plugin named by the registry or
allowlist.

Local-rule scaffold is only needed for `local/*` ratchets:

- `eslint.config.js` must export a config array containing
  `plugins.local.rules`. The loader reads that object to discover
  `local/<rule-name>` metadata.
- Each ratcheted local rule needs an `eslint-rules/<rule-name>.js` source file.
  The runner hashes this exact file for `ruleSourceHash`.
- Each local rule's `meta.docs` must include `description`, `principle`,
  `category`, `pairedGuide`, and `repairKind`; `pairedGuide` should point at an
  existing guide path unless the project replaces `scripts/lint-rule-docs.ts`
  with a reduced policy stub.

Projects that only ratchet core ESLint rules or third-party plugin rules can
skip `eslint.config.js` local-plugin wiring and `eslint-rules/` files by using
that reduced `scripts/lint-rule-docs.ts` stub.

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
  `scripts/lint-rule-docs.ts`.
- Local rules themselves: adopters do not need local rules to use the ratchet
  for core or third-party ESLint rules.
- Report artifact env var: `LINT_RATCHET_REPORT_ARTIFACT_URL` is part of the
  portable surface. The runner's single source of truth is the exported
  `LINT_RATCHET_REPORT_ARTIFACT_URL_ENV` constant in
  `scripts/lint-ratchet-report.ts`. If you rename it, update that constant and
  every workflow `env:` key that still exports the old literal name; otherwise
  the runner silently omits the `Artifact:` line.
- Registry preflight: `lint:ratchet` and `lint:ratchet:check-registry` both
  enforce `registry-shape`, so adopters whose pre-commit invokes the heavy
  runner already get that shape validation. `empty-glob` and `absolute-path`
  detection live only in `lint:ratchet:check-registry`; skipping it leaves real
  holes where a typoed `files` glob can silently create a no-op ratchet and
  absolute local paths are not rejected. Run `lint:ratchet:check-registry` as a
  real gate in CI at minimum, and in local pre-commit when you want the same
  guarantee before push.

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

The minimum CI setup runs the ratchet, checks the committed baseline, and always
uploads the diagnostics envelope. Swap `bun` for the adopter's package manager
if needed:

```yaml
- name: Check lint ratchet registry
  run: bun run lint:ratchet:check-registry
- name: Run lint ratchet
  run: HARNESS_DIAGNOSTICS_OUTPUT=lint-ratchet-diagnostics.json bun run lint:ratchet
- name: Check lint ratchet baseline
  run: bun run lint:ratchet:check-baseline
- name: Upload lint ratchet diagnostics
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: lint-ratchet-diagnostics
    path: lint-ratchet-diagnostics.json
```

The registry preflight gives those misconfigurations a `check-registry` failure
label separate from a generic "Lint ratchet failed" ESLint step, so adopters
can identify a missing local-rule file, empty glob, absolute path, or orphan
baseline id from the workflow run UI before expanding logs. See
`.github/workflows/ci.yml` in this repository for the worked example.

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
  findings. For intentional accepted debt, run
  `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` and capture
  the rationale in the commit message.

Avoid hand-written path filters on the ratchet workflow:

- The safe default is no path filter — run the ratchet workflow on every PR and
  push.
- Filtering is fragile because a ratchet's scope often spans more files than
  the immediate diff. A rename, config change, baseline edit, runtime helper
  change, or parser project change can change ratchet outputs without touching
  the files matched by a narrow source filter.
- If an adopter still insists on path filters, the required trigger union must
  cover the registry source globs themselves, meaning every `files` glob from
  every `ratchet/*` entry; the ratchet runtime files listed in the
  `Minimum runtime file set` bullets earlier in this section; and per-project
  control inputs that change ratchet identity, including `eslint.config.js` and
  any included config files, the registry source file such as
  `scripts/lint-ratchet-config.ts`, `eslint-rules/**` for local-rule projects,
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
  a ratcheted path diverges from the committed baseline in either direction:
  regressions above the floor, or improvements below the floor because the
  current findings are lower than the baseline. Improvements enter the envelope
  as blocking harness findings with the recovery command in `howToFix`.
- `bun run lint:ratchet:check-registry` validates the ratchet registry, the
  `files`/`ignores` globs, and the committed baseline ids without running
  ESLint. It is the fast preflight an adopter runs after copying the files and
  writing one registry entry, before `bun run lint:ratchet:update` generates a
  baseline. On failure it prints adopter-friendly `<kind>: <message>` lines and
  exits non-zero, where `<kind>` is one of `registry-shape`, `empty-glob`,
  `absolute-path`, or `orphan-baseline`. Its `registry-shape` failure kind
  overlaps with the heavy runner's startup validation, so adopters who run
  `lint:ratchet` already get registry-shape failures from pre-commit; the
  `empty-glob` and `absolute-path` failure kinds are unique to
  `lint:ratchet:check-registry`, not caught by the heavy runner, and the labeled
  CI step both surfaces a clearer failure name and closes those two gaps. When
  `lint-ratchet.baseline.json` does not yet exist, the orphan-baseline check is a
  no-op, so the command remains useful before the first baseline is generated.
- `bun run lint:ratchet:check-baseline` validates that
  `lint-ratchet.baseline.json` is deterministic, still matches the ratchet
  registry, and enforces the same strict gate in both directions. It exits
  non-zero on regressions or improvements and names the affected paths.
- `bun run lint:ratchet:summary` reads the committed
  `lint-ratchet.baseline.json` and prints a per-ratchet table without running
  ESLint. It is informational only: it never fails on findings and never
  rewrites the baseline. The table columns are ratchet id, rule id, metric, file
  count, and total findings. Total findings sum the per-file `count` across
  files for every metric, so `complexity-severity` rows show the number of
  findings rather than a `maxComplexity` aggregate. Use it to spot which
  ratchets carry the most debt without diffing the 1390-line baseline JSON by
  hand.
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
  No `--allow-worse` flag is needed because lowering the baseline is not
  worsening it. If a rename or intentional policy change makes the generated
  baseline worse, use
  `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` and put the
  durable rationale in the commit message.

Strict improvement enforcement is the default. The ratchet is symmetric: neither
a regression nor an improvement may diverge from the committed baseline without
explicit acknowledgement. Regressions require fixing the new or worse findings,
or updating with `--allow-worse`; improvements require
`bun run lint:ratchet:update` so the committed floor moves down monotonically.

## Metrics and baseline items

Registry entries choose one metric. Default and check-baseline modes compare
that metric to the committed item for exact agreement: higher values are
regressions, lower values are improvements, and either direction must be handled
through the commands above.

- `message-count` stores per-file `{ "count": N }`; the diagnostic count is
  the compared value. This remains the default for bug-class and finding-class
  rules where each new violation is already a separate ESLint diagnostic.
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
diagnostic line and `nodeType`; it does not reimplement ESLint's cyclomatic
complexity visitor.

Default and check-baseline modes require metric-specific fields. For a converted
`effective-line-count` or `complexity-severity` ratchet, a count-only committed
item is a schema mismatch.
`update` mode uses structural parsing so one-shot migrations can rewrite old
count-only entries, but it still refuses any generated count, `lines`, max
complexity, or complexity-vector regression unless
`--allow-worse --reason "<why>"` is supplied.

## Current ratchets

- `ratchet/local-max-lines` tracks `local/max-lines` by effective line count
  across the default 300-effective-line scope. Files with explicit higher caps
  in `eslint.config.js` remain governed by those local overrides instead of
  being mixed into this default-options ratchet.
- `ratchet/local-type-assertion-boundary` tracks
  `local/type-assertion-boundary` by per-file message count across package,
  script, and e2e TypeScript files.
- `ratchet/strict-boolean-expressions-shared` tracks
  `@typescript-eslint/strict-boolean-expressions` by per-file message count
  across `packages/shared/src` production TypeScript. Its initial 6-finding
  scope and options came from a focused type-aware rule inventory.

For `ratchet/local-max-lines`, the exact-path ignores in
`scripts/lint-ratchet-config.ts` mirror the per-file higher-cap overrides in
`eslint.config.js`. When renaming or splitting one of those files, update both
lists in the same change so the ratchet and ESLint gate keep the same scope.
Script or test max-lines debt should normally get its own narrowly named
ratchet instead of expanding this default package-oriented scope.

Path renames move baseline keys. A rename that keeps or lowers the count should
update the baseline in the same commit. A rename that also increases the count
needs the explicit `--allow-worse --reason` path.

## Baseline identity

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
first run after strict-improvement metadata is introduced. Generated baseline
regressions are still rejected unless `--allow-worse --reason "<why>"` is
supplied.

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
   ignore/unignore/parser config and current ratchet registry. Keep that map in
   a durable project-doc location. Classify tracked maintained surfaces as
   normal lint, existing ratchet/floor, proposed floor, intentional exclusion,
   or named blocker/follow-up; do not start baselining batches while any
   temporary `unknown` classification remains.
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
   `bun run lint:ratchet` and `bun run lint:ratchet:check-baseline`.
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
