# Lint Ratchet

New to the lint setup overall? Read the [Lint System Overview](lint-overview.md)
first; it maps all the parts, shows the whole pipeline in one diagram, and
explains where the ratchet fits.

The lint ratchet tracks selected existing lint debt without allowing it to
grow. Normal `bun run lint` stays strict; `bun run lint:ratchet` is an
additional gate for rules that are being drained from a committed baseline.

This is the operator guide: the first-ratchet quickstart, the command reference,
the baseline lifecycle, and merge recovery. Two companion docs go deeper:

- [Lint Ratchet Reference](lint-ratchet-reference.md) — the internals: the
  coverage-map gate, CI parity wiring, metrics, baseline identity and
  rule-source hashing, parser profiles, registry preflight, and advanced rollout
  patterns.
- [Lint Ratchet Adoption](lint-ratchet-adoption.md) — for projects copying the
  ratchet into their own codebase. It presents two adoption tiers (minimal
  ratchet vs full platform), explains the runtime copy model, and names the
  ongoing ownership cost.

For projects adapting the ratchet to Biome diagnostics, see
[Biome Lint Adoption](biome-lint-adoption.md). The baseline and comparison
model are portable; the current runner and reach checks are ESLint-specific.

## First ratchet in 10 minutes

Start with one core ESLint rule and a small, real file scope. For a ready-made
worked copy to diff against as you go, see
[`examples/lint-ratchet-demo/`](../../examples/lint-ratchet-demo/) — a minimal
workspace consumer of the `@musi/lint-ratchet` package.

1. Copy the engine and write a thin adapter:

   - Copy `tools/lint-ratchet/` (the whole package) into your repo, or add it as
     a dependency. Its per-layer subpath exports are the whole API.
   - Write a small adapter like the demo's `scripts/lint-ratchet.ts` +
     `scripts/lint-ratchet/adapter.ts`: a `LintRatchetEngineContext`/binding over
     your repo root, your registry, and a result envelope.
   - Copy the demo's `scripts/git/*` + the two CLI wrappers when adopting the
     recommended semantic merge protection described below.
   - `lint-ratchet.baseline.json`, initially
     `{ "version": 2, "regenerate": "bun run lint:ratchet:update", "tests": {} }`.

2. Declare your registry in the adapter — import `LintRatchetConfig` from
   `@musi/lint-ratchet/kernel/config-types.js`, with no Musi imports, and start
   `lintRatchets` with the entry below. The adoption guide's
   [registry step](lint-ratchet-adoption.md#what-to-change) covers the details.

3. Add package scripts for `lint:ratchet:check-registry`,
   `lint:ratchet:update`, and `lint:ratchet`.

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
  metric: "message-count",
  repairKind: "manual",
  principle: "Keep console output from growing beyond today's intentional logging and debug debt.",
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

For the full copy set and the minimum copied test set, see
[Lint Ratchet Adoption](lint-ratchet-adoption.md#what-to-copy-for-tests).

## Commands

- `bun run lint:ratchet` emits a `harness-diagnostics` envelope and fails when
  registry preflight fails or a ratcheted path diverges from the committed
  baseline in either direction: regressions above the floor, or improvements
  below the floor because the current findings are lower than the baseline.
  Improvements enter the envelope as blocking harness findings with the
  recovery command in `howToFix`.
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
- `bun run lint:ratchet:check-debt-accounting` compares the current baseline to
  the merge-base version from `origin/main` or `origin/master`. Pass
  `--base-ref <ref>` for repositories whose fetched comparison branch has a
  different name. Pre-commit adds `--staged`, so current baseline and debt-log
  content comes from stage-0 index blobs rather than an independently modified
  worktree; manual and verify runs use worktree content. If every candidate ref
  is unavailable, the command emits a `WARN` before its weaker `HEAD^` fallback
  or SKIP, including fetch/configuration remediation. Any per-path baseline increase with the same
  ratchet `configHash` must have a same-range `lint-ratchet.debt-log.jsonl`
  regression entry for the same `(testId, path)`. Overlapping paths remain
  comparable when only the config hash changes; a metric change instead needs a
  reasoned metric-migration record. Base ratchet ids missing from the current
  baseline need either a logged orphan removal or a proven-retirement record.
  When a surviving ratchet changes `files` or `ignores` and baselined paths
  disappear, update requires `--allow-worse --reason` and appends a
  `coverage-shrink` record containing both glob sets and the removed paths;
  removed paths with unchanged globs remain ordinary fixes.
  This catches hand-edited floors and removed guards that would otherwise bypass
  `--allow-worse --reason`; only genuinely new ratchet adoption is exempt.
- `bun run lint:ratchet:summary` reads the committed
  `lint-ratchet.baseline.json` and prints a per-ratchet table without running
  ESLint. It is informational only: it never fails on findings and never
  rewrites the baseline. The table columns are ratchet id, rule id, metric,
  `debt files`, and total findings. `debt files` counts baseline item keys—the
  files that currently carry findings—not every file evaluated by the ratchet's
  scope. For a zero-baseline ratchet's full evaluated scope, use the `Files`
  column in `bun run lint:ratchet:zero-baseline`. Total findings sum the per-file
  `count` across files for every metric, so `complexity-severity` rows show the
  number of findings rather than a `maxComplexity` aggregate. Use the summary to
  spot which ratchets carry the most debt without diffing the committed baseline
  JSON by hand. Add `--by-directory [depth]` to group each ratchet's remaining
  findings by repo-relative directory prefix; the default depth is `3` (for
  example `packages/client/src`), and rows sort largest-first within each
  ratchet.
- `bun run lint:ratchet:trend` walks `git log` for
  `lint-ratchet.baseline.json`, structurally parses each historical baseline,
  and prints active/retired status plus first/last/min/max finding totals per
  ratchet. `last` is the most recent historical baseline point, not a claim that
  retired debt is current. The default view includes active registry entries
  only and reports how many retired series it omitted; add `--all` for complete
  history. Use `--since <date>` or `--max <n>` to narrow the history window. The
  command is informational only and never runs ESLint. Historical baseline blobs
  that cannot be parsed are skipped with a warning instead of failing the
  command; ratchet id renames appear as one series ending and another starting.
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
  is needed because lowering the baseline is not worsening it. If a rename or
  intentional policy change makes the generated baseline worse, use:

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
  A metric migration is gated on its own rationale: for a migration-only update
  a plain `--reason "<why the new metric is the right measure>"` suffices, but a
  mixed update that also accepts new debt answers two different questions with
  two flags, so give the migration its own reason:

  ```sh
  bun run lint:ratchet:update -- --allow-worse \
    --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>" \
    --migration-reason "<why the new metric is the right measure>"
  ```

  The accepted-debt entry then records the `--reason` text while the
  metric-migration entry records the `--migration-reason` text.
  Retiring a *zero-finding* ratchet whose rule was promoted into normal lint is a
  strict improvement, not accepted debt, so it must not go through `--allow-worse`.
  Use `bun run lint:ratchet:update -- --retire-ratchet <id>` instead (see the
  [Zero-Baseline Lifecycle](#zero-baseline-lifecycle)): it drops the orphaned floor
  with a non-debt retirement record in the debt log, but only after proving
  normal lint now errors on the retired scope — a zero baseline alone never
  proves the guard was replaced. The
  flag is mutually exclusive with `--allow-worse`.
  When normal lint is at `error` throughout the scope but uses different rule
  options, add `--accept-different-options --reason "<why the replacement is at
  least as strong>"`. The command does not infer whether arbitrary rule options
  are stricter: it prints the ratchet and resolved normal-lint options, requires
  the human attestation, and stores that delta in the non-debt retirement record.
  `warn`, `off`, ignored, empty, and mixed scopes still fail.
- `bun run lint:ratchet:debt-log` renders the committed debt log as
  GitHub-flavored markdown (sticky-comment marker `<!-- lint-ratchet-debt-log -->`,
  one section per record, oldest first). The report totals accepted-debt records
  separately from retirement/removal records. Legacy accepted-debt-shaped entries
  that contain no regressions and only orphan removals render as `Legacy
  retirement/removal`, preserving append-only history without presenting old
  promotions as debt acceptances. It is read-only and never fails: on a clean
  tree with no recorded entries it prints an empty report and exits 0.
  Accepted-debt lines cover the `--allow-worse` regression set plus orphan
  (renamed/removed registry id) removals with the committed baseline snapshot
  that is being dropped. Proven `--retire-ratchet` operations append a separate
  non-debt retirement record so accounting can distinguish a promoted guard from
  an unaccounted deletion. Metric changes require a reasoned migration record
  because their per-path values are not comparable. Routine tightening updates
  and improvement locks write nothing, and a first-ever
  baseline (initial adoption) logs nothing because there is no committed baseline
  to compare against. Each line deliberately omits
  timestamp, branch, parent commit, committer, and baseline hashes: PR reviewers
  derive those from the commit, blame, and the `lint-ratchet.baseline.json` diff,
  so the log stays a minimal, human-reviewable record of *why* debt was accepted.
  The renderer stays read-only and never auto-commits. Debt-log accounting is
  enforced by CI and full `verify` through `lint:ratchet:check-debt-accounting`;
  staging and committing the paired log entry remains a deliberate human step.
  Append retries validate the record before writing, preserve tail de-duplication,
  and insert a separating newline when a non-empty hand-edited log lost its final
  newline. The accounting backstop matches each recorded regression reason to the
  comparison priority (`increased-lines`, then `increased-complexity`, then count
  or new-path), so one acceptance cannot absorb a different kind of raise.

Strict improvement enforcement is the default. The ratchet is symmetric: neither
a regression nor an improvement may diverge from the committed baseline without
explicit acknowledgement. Regressions require fixing the new or worse findings,
or updating with `--allow-worse`; improvements require
`bun run lint:ratchet:update` so the committed floor moves down monotonically.

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
explicit third-party source and parser profile. See
[Rule sources and parser profiles](lint-ratchet-reference.md#rule-sources-and-parser-profiles)
for the source shapes. The third-party/type-aware infrastructure was added
after the original local-rule runner and was first used for a
strict-boolean-expressions ratchet.

Core ESLint rules such as `complexity`, `max-params`, and
`no-nested-ternary` use the explicit core source shape and a bare built-in rule
id.

## Current ratchets

The active ratchet registry is the exported `lintRatchets` array in
`scripts/lint-ratchet/lint-ratchet-config.ts`. Run
`bun run lint:ratchet:summary` for the current ids, rules, metrics, debt-bearing
file counts, and finding totals. This guide intentionally does not hand-copy
the registry, because the committed list changes more often than the operating
model.

Path renames move baseline keys. A rename that keeps or lowers the count should
update the baseline in the same commit. A rename that also increases the count
needs the explicit `--allow-worse --reason` path.

## Merge Conflicts

Merge-driver setup, truth-up, and conflict recovery now live in the
[Lint Ratchet Merge Runbook](lint-ratchet-merges.md). This compatibility
heading preserves existing inbound links to the old section anchor.

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
   floor without `--allow-worse`, appends a non-debt retirement record to
   `lint-ratchet.debt-log.jsonl`, and prints that coverage was promoted and the
   retirement recorded. A zero baseline
   alone is not enough — the updater first re-runs the normal-lint coverage probe
   and only retires when normal lint still errors on the retired scope. If that
   proof fails (the rule was dropped without a replacement, or only some files
   are covered), the command refuses and tells you to accept the removal as debt
   with `--allow-worse --reason "<...>"` instead. Retirement and `--allow-worse`
   are mutually exclusive: one promotes a proven guard, the other logs accepted
   debt.
   If every file resolves the rule at `error` with different options, review the
   printed option delta. When the normal-lint policy is at least as strong, use
   `bun run lint:ratchet:update -- --retire-ratchet <id>
   --accept-different-options --reason "<why>"`; the attestation is committed in
   the retirement record without creating false accepted debt.
4. If normal ESLint is `off`, `warn`, ignored, or mixed, promote the matching
   rule/options to normal ESLint at `error` before removing the ratchet. Until
   error coverage is proven, `--retire-ratchet` refuses and the removal must go
   through `--allow-worse --reason "<...>"`.

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

## Where to go next

The deeper mechanics moved to companion docs. These compatibility anchors keep
existing inbound links working and point to the canonical home:

### Coverage Map Gate

The coverage-map gate details now live in the reference doc:
[Coverage Map Gate](lint-ratchet-reference.md#coverage-map-gate).

### Portable adoption

Copying the ratchet into another repository is covered end to end in
[Lint Ratchet Adoption](lint-ratchet-adoption.md), including the full copy set,
merge-driver wiring, runtime assumptions, and what you own afterward. The
runtime and registry-preflight internals behind the copy set are in the
[reference doc](lint-ratchet-reference.md#registry-preflight-and-runtime-internals).

### Test portability

The minimum portable test set moved to the adoption guide:
[what to copy for tests](lint-ratchet-adoption.md#what-to-copy-for-tests).

Other deep topics:

- [Metrics and baseline items](lint-ratchet-reference.md#metrics-and-baseline-items)
- [Baseline identity and rule-source hashing](lint-ratchet-reference.md#baseline-identity)
- [Rule sources and parser profiles](lint-ratchet-reference.md#rule-sources-and-parser-profiles)
- [CI parity](lint-ratchet-reference.md#ci-parity)
- [Adoption patterns](lint-ratchet-reference.md#adoption-patterns)
