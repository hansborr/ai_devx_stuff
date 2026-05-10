# AI Drift Sensors

Status: Leaves 1 (skeleton), 2a (parser/filter), 2b (jscpd subprocess +
integration), 3 (custom ghost-file detector), 4 (comment-ratio warning),
and 5 (aggregate report and harness map) have landed. Leaf 6 (evaluate
promotion) waits for several real uses before deciding whether any
subcheck deserves stronger wiring.
Date: 2026-05-10 (Leaf 5 landed; skeleton landed 2026-05-09 on
`feat/misc-loop`)

## Goal

Add report-only sensors for AI-specific codebase drift before turning any of
them into gates. The first useful checks are duplicate-code detection with
`jscpd` and a Musi-specific ghost-file detector for newly added files that look
like accidental parallel modules.

This is a harness workstream, not a cleanup sprint. The first pass should make
drift visible, tune noise down, and give agents clear repair text. Do not wire
these checks into pre-commit, `verify:changed`, or Stop until the reports have
low noise and a human explicitly promotes a subcheck.

## Principles

- Default to exit 0. Findings are warnings unless `--fail-on-findings` is added
  in a future leaf.
- Scope to changed or newly added files first. Full-repo scans are useful for
  audits, but too noisy for the edit loop.
- Prefer structured output plus compact text. Text is for agents; JSON is for
  future dashboards or hook consumers.
- Ignore generated files, build output, docs, migrations, screenshots, and
  dependency folders by default.
- Do not grow `AGENTS.md`. Pair the command with this note and
  `docs/ai-harness.md`.
- Every finding needs a repair hint: reuse an existing module, run code intel,
  extract a shared helper, or leave a reviewed reason for keeping both files.

## Proposed Command

```bash
bun run drift:ai
bun run drift:ai --base main
bun run drift:ai --check duplicates
bun run drift:ai --check ghost-files
bun run drift:ai --format json
```

Default behavior:

- Compare against the merge base with `main` or the provided `--base`.
- Run only checks that can use changed-file scope.
- Print a short warning report and exit 0.
- Write optional machine-readable output only when `--format json` or
  `--output <path>` is passed.

## Leaf Plan

### Leaf 1: Command Skeleton And Changed-File Scope (LANDED)

Stable interface in `scripts/drift-ai.ts`: `parseArgs`,
`discoverChangedFiles` (two-dot diff + untracked), `resolveBaseRef`,
`filterScope`, `buildReport`, text/JSON output, `runDriftAi`. Wired into
`package.json`, `tsconfig.scripts.json`, `scripts/test-changed.sh`, and
`scripts/test-test-changed.sh`. New checks opt in by joining
`IMPLEMENTED_CHECKS` and registering a runner in `CHECK_RUNNERS`.

### Leaf 2: jscpd Duplicate-Code Report

Purpose: catch agent-created copy/paste drift when a changed file duplicates
nearby implementation.

Tool choice:

- Use `jscpd` because it already supports TypeScript and JSON reports.
- Add it as a dev dependency once the wrapper behavior is tested. Prefer a repo
  dependency over `bunx` so reports are reproducible.

Behavior:

- Run `jscpd` with JSON reporting into a temp/report directory.
- Scan the smallest useful scope for each changed source file:
  - package source root for `packages/{shared,server,client}/src/**`
  - `scripts/` for script changes
  - `eslint-rules/` for local rule changes
- Filter the JSON report to clones where at least one side is a changed file.
- Default ignore tests and fixtures in the duplicate check at first. Add
  `--include-tests` only after production-source noise is understood.
- Print the top findings with both file paths, line ranges, duplicated line
  count, and a repair hint.

Split into two slices so each fits one focused agent iteration:

#### Leaf 2a: jscpd Report Parser And Changed-File Filter (LANDED)

`jscpd` added as a root dev dependency. `scripts/drift-ai/duplicates.ts`
provides pure jscpd JSON parsing, report-path normalization, changed-file
clone filtering, and finding mapping with the canonical repair hint.
Fixture-backed coverage in `scripts/drift-ai/duplicates.test.ts`. No
subprocess yet.

#### Leaf 2b: jscpd Subprocess Runner And drift:ai Integration (LANDED)

`mapChangedFilesToScopes`, `defaultJscpdRunner`, and `runDuplicatesCheck`
in `scripts/drift-ai/duplicates.ts`. `DEFAULT_DUPLICATES_MIN_LINES = 30`;
`DEFAULT_DUPLICATES_IGNORE_GLOBS` skips tests, fixtures, and `*.d.ts`.
`defaultJscpdRunner` shells out to `node_modules/.bin/jscpd`, reads
`jscpd-report.json`, and cleans up the temp dir in `finally`. Subprocess
failures surface as a single finding so drift:ai still exits 0.
`runDriftAi` accepts an injectable `jscpd` runner; tests cover scope
mapping, runner invocation, finding conversion, and end-to-end through
runDriftAi.

Noise controls if duplicates output is too loud: raise min-lines, filter
import-only / schema-table-only clones, never fail on baseline
duplication.

### Leaf 3: Custom Ghost-File Detector (LANDED)

`scripts/drift-ai/ghost-files.ts` exports `tokenize`, `singularize`,
`isExcludedSibling`, `findGhostMatches`, and `runGhostFilesCheck`, plus
`defaultDirectoryListing(repoRoot)` (swallows missing dirs so the report
stays report-only). Three match kinds, in order: `identical-normalized`,
`weak-suffix-variant` (against a `helper`/`util`/`service`/... weak-token
list), and `near-edit-distance` (bounded Levenshtein ≤ 2, requires
strong-token overlap and length ≥ 4). Tests/fixtures/`*.d.ts` excluded
on both candidate and peer side. Symmetric pairs deduped to the
lex-smaller primary. Wired into `CHECK_RUNNERS`/`IMPLEMENTED_CHECKS`;
`runDriftAi` takes an injectable `listDirectory`. Inline-fixture
coverage for true and false positives in
`scripts/drift-ai/ghost-files.test.ts`; integration test in
`scripts/drift-ai.test.ts`.

False-positive policy stays report-only; add ignore config only after a
real FP repeats. The "MODULE.md should mention every new sibling" check
is intentionally deferred to a later stale-module-doc sensor.

Review follow-up: `runDriftAi` resolves the merge base before collecting the
two-dot working-tree diff, so advanced `main` does not pollute scope while
uncommitted tracked edits still appear. `test:changed` now treats the full
`scripts/drift-ai/` subtree, including fixtures, as scripts-project relevant.
Ghost-file exclusions are path-aware for test/fixture directories on both
candidate and peer sides, peer output is sorted for stable reports, and copied
paths are treated as new-file candidates.

### Leaf 4: Comment-Ratio Warning (LANDED)

`scripts/drift-ai/comments.ts` exports `analyzeCommentMetrics`,
`runCommentsCheck`, `defaultFileReader(repoRoot)`, and the
`DEFAULT_EFFECTIVE_LINES_THRESHOLD = 120` /
`DEFAULT_COMMENT_RATIO_WARN = 0.4` constants. The single-pass classifier
tracks string and block-comment state across line boundaries so `//` and
`/*` inside strings stay code, and `*/` mid-line followed by code keeps
the line effective. `isExcludedFromComments` keeps tests, fixtures,
`scripts/`, `eslint-rules/`, and `*.d.ts` out of the first cut. Findings
include the rounded percent, effective-line count, and the active
threshold so output stays self-describing. Wired into
`drift-ai.ts` `CHECK_RUNNERS`/`IMPLEMENTED_CHECKS`; `runDriftAi` accepts
an injectable `readFile` and the CLI entrypoint constructs
`defaultFileReader(repoRoot)`. Unit coverage in
`scripts/drift-ai/comments.test.ts` covers the analyzer (block/line/
string interactions, CRLF, trailing newline), runner (threshold,
ratio, ordering, excluded paths, deleted/missing files, custom
threshold/ratio), and the path-traversal-safe default reader.
Integration coverage in `scripts/drift-ai.test.ts`.

Repair hint preserves the invariant guidance:
`keep comments that explain invariants, concurrency, authorization, or
rules provenance; remove narration that restates code.`

### Leaf 5: Aggregate Report And Harness Map (LANDED)

`bun run drift:ai` runs `duplicates`, `ghost-files`, and `comments` by
default; `--check <id>` (and `--check all`) narrows or expands the set,
and `parseArgs` keeps the default aligned with `ALL_CHECKS`/
`IMPLEMENTED_CHECKS`. `docs/ai-harness.md` now has a `drift:ai` sensor
row in the Sensors table, paired with this in-progress note. The
`ai-harness-followups` backlog points at the live command and at Leaf 6
as the gate decision. `bun run test:changed` already selects the
scripts vitest project (and the drift-ai test files) when
`scripts/drift-ai.ts` or `scripts/drift-ai/*` changes; the
`test-test-changed` smoke covers `scripts/drift-ai.ts`,
`scripts/drift-ai/duplicates.ts`, and a fixture path under
`scripts/drift-ai/fixtures/`. No new scanner or hook wiring landed.

### Leaf 6: Evaluate Promotion

Purpose: decide whether any subcheck deserves stronger wiring.

Only after several real uses:

- Summarize noise rate and useful findings in `LOG.md` or this note.
- Consider adding `drift:ai` to `doctor` as a warning-only report.
- Do not add it to pre-commit or `verify:changed` unless a specific subcheck is
  fast, low-noise, and has clear repair text.

## Open Decisions

- Whether `jscpd` should scan tests by default. Initial answer: no.
- Whether to store a full-repo duplicate baseline. Initial answer: no; filter
  to duplicates involving changed files instead.
- Whether ghost-file ignores should live in config. Initial answer: hard-code
  only obvious ignores, then add config if false positives repeat.
- Whether to include Knip. Initial answer: not in this workstream. Knip is a
  good future unused-file/export sensor, but ghost-file detection is about
  suspicious new siblings even when they are imported.

## References

- jscpd JSON reporter: https://jscpd.dev/reporters/json
- jscpd overview: https://jscpd.dev/
- Knip unused files and exports: https://knip.dev/
