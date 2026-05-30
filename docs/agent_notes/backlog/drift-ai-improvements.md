# drift:ai — Findings & Improvement Roadmap

Status: Review note, 2026-05-28. Report-only assessment of the `drift:ai`
sensor; no source changed. Produced by a four-perspective agent review
(reporting UX, code quality/architecture, standalone extraction, external-check
research) with a cross-pollination round. Detailed per-perspective notes with
`file:line` evidence live in `drift-ai-review/`:

- `drift-ai-review/ux-reporting.md`
- `drift-ai-review/code-quality.md`
- `drift-ai-review/standalone-extraction.md`
- `drift-ai-review/additional-checks-research.md`

All findings below were re-verified against the source by the lead before
synthesis.

Update, 2026-05-29: follow-up discussion clarified the portability target. The
first deliverable is **tool-checkout portability**: run drift:ai from the stripped
`/home/node/tmp/ai_devx_stuff` / future `ai_devx_tools` checkout, using Bun as
the tool runtime, against another Git repo that may use pnpm and does not adopt
Bun. A later Node/npm package remains possible, but it is no longer the first
bar. The target project should not need to install drift:ai's implementation
dependencies just to be scanned.

Update, 2026-05-30: this note is historical review input, not the current
operator contract. Current drift:ai usage and feature docs live in
`scripts/drift-ai/README.md`; the harness inventory lives in `docs/ai-harness.md`
and `docs/generated/harness-controls.md`. Several review items below have since
landed, including plugin metadata, opt-in `orphan-files` / `import-cycles` /
`near-duplicates`, `hotspots`, findings summaries, chunk grouping, and
`--fail-on-findings`.

## What drift:ai is today

A report-only "AI drift sensor" CLI (`scripts/drift-ai.ts` + `scripts/drift-ai/`,
~7,300 LOC across ~40 files). It flags code-quality patterns AI agents tend to
introduce. Four checks plus one Musi-specific subcommand:

| Check | Catches | Engine |
|---|---|---|
| `duplicates` | copy/paste duplicate blocks | shells out to `jscpd` |
| `ghost-files` | suspicious new sibling modules (`foo-helpers.ts` beside `foo.ts`) | filename token + Levenshtein heuristic |
| `comments` | over-narration (comment-to-code ratio) | single-pass line classifier |
| `suppressions` | newly added `eslint-disable` / `@ts-*` comments | diff + comment scanner |
| `harness-freshness` (subcommand) | `docs/ai-harness.md` vs `docs/guides` drift | Musi-only |

Two scope modes: `changed` (diff vs `main`, default) and `current` (whole repo —
built **specifically to audit a separate project**, per `drift-ai-current-scope.md`).
Output: text or JSON, optional `--chunk-dir`/`--chunk-size` for AI handoff.
Config: `drift-ai.config.json`, auto-discovered. Always exits 0.

**Overall verdict:** the tool is genuinely well-engineered — clean
dependency-injection seams (git/jscpd/fs runners are injected and defaulted),
consistent `DriftAiError` + report-only contract, and behavior-focused tests
with real fakes (no `vi.mock`). It already runs unmodified against a non-Musi
repo. The improvements below are about sharpening trust, collapsing accidental
complexity, and turning an already-portable script into a deliberately portable
tool.

---

## The unifying thesis

The four perspectives converge on a single highest-leverage change. **A
`CheckPlugin` registry is the shared enabler for every other improvement:**

- **Maintainability:** adding a check today touches ~8 sites across 5 files; a
  registry makes it one new file.
- **New checks:** import-cycles / near-duplicate land as drop-in plugins.
- **Standalone extraction:** the "portable core" becomes literally "the default
  plugin array"; Musi-specific checks (`harness-freshness`) just aren't in it.
- **Reporting:** a `CheckOutcome` union (`ran` vs `skipped`-with-reason) fixes
  the "why did this check not run?" gap *and* lets a plugin declare its own
  external dependency and degrade gracefully — so the target repo never needs to
  install drift:ai implementation dependencies just to be scanned.

The registry remains the clean long-term shape, but it should not block the first
external-repo workflow. The first portability slice can be smaller: documented
`cd <target> && bun <tools>/scripts/drift-ai.ts`, tool-owned `jscpd` resolution,
generic hints, and a starter config. Then the registry can carry the broader
single-report work.

---

## Part A — Reporting: is it clear and useful?

Mostly yes, and notably better than typical lint output: FIX hints are concrete
(ghost-files and suppressions even embed a runnable `code:intel` command), and
the clean-run line (`OK: no findings from checks: ...`) is informative. But the
*with-findings* and *machine* paths have real gaps. (Full detail + before/after
mockups: `drift-ai-review/ux-reporting.md`.)

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| A1 | High | **JSON is ~99% noise.** `scope` (1,672 paths in current mode) is serialized *before* `findings`, so `--format json \| head` shows zero findings. | `report-builder.ts` key order → `types.ts` `DriftReport`; `report-format.ts:38` | Emit `findings` first; make full `scope` opt-in (`--include-scope`); always emit `scopeCount`. |
| A2 | High | **No findings summary anywhere.** With-findings text is a flat WARN list with no totals; JSON has no summary object. The clean run is ironically more informative than a dirty one. | `report-format.ts:31-35` | Add a header/footer line `findings: 4 (duplicates 2, ghost-files 1, comments 1)` and a JSON `summary` object. |
| A3 | High | **Chunk mislabel.** A chunk's `check` field and filename come from `slice[0].check`, but a size-slice can span multiple check groups — so `001-duplicates.json` can contain ghost-files/comments findings; the manifest then misrepresents it. | `chunks.ts:31,55` | Either split chunks on check boundaries, or rename to a neutral `NNN-findings.json` and let `check` be `"mixed"` when a slice spans checks. |
| A4 | Med | **Skipped checks have no reason.** `--check suppressions --scope current` prints both "skipped" and "no implemented checks selected" — a confusing dead end. | `report-format.ts:24-27`; `report-builder.ts:188-191` | First-class `skipped: {check, reason}[]` (ties to B-thesis `CheckOutcome`); render the reason. |
| A5 | Med | **Self-overlap duplicate reads as broken math.** A real finding renders `monster-form-fields.tsx:436-474 — duplicates monster-form-fields.tsx:435-474` (same file, overlapping ranges). | live `--scope current` output; `duplicates.ts:104` | Detect same-file clones and label them "repeated block within file". |
| A6 | Low | **No opt-in CI failure mode.** Report-only/exit-0 is the right *default*, but there's no `--fail-on-findings` for users who want a gate. | `runner.ts:121` | Add opt-in `--fail-on-findings[=check,...]`; keep exit 0 the default. |

Note: the existing triage in `drift-ai-current-findings.md` is **stale** — its
top ghost-files follow-up is already resolved via `currentAllowedPairs` in the
config; current scope now yields 4 findings, not the 18 that note describes.

---

## Part B — Code quality, maintainability & architecture

Strong foundation; two structural issues dominate. (Full detail with every
`file:line`: `drift-ai-review/code-quality.md`.)

### B1 (High) — Shared helpers were copy-pasted across max-lines splits — and have already drifted

The `local/max-lines` (300) ratchet forced three modules to split in half, and
private helpers were duplicated across the seam instead of extracted:

- `toPosix` is defined **4×** and **three are not equivalent** (`ghost-files-tokens.ts:103`,
  `comments.ts:192`, `duplicates.ts:170` via `normalizeRepoPath`) — so a path
  can normalize differently between the duplicates and comments checks.
- `changedFilesFromScope` is **byte-identical** across `ghost-files-changed.ts:86`
  and `duplicates-runner.ts:295`; `isSourceLike` ×4; `uniqSorted` ×3; sort
  comparators duplicated verbatim.

This is exactly the drift the tool exists to detect — it would flag itself.
**Fix:** one `scripts/drift-ai/path-util.ts` with canonical `toPosix` /
`isSourceLike` / `uniqSorted` / `changedFilesFromScope` / `sortFindings`; pick
the `normalizeRepoPath`-based `toPosix` as canonical and pin it with a test.
Do this **first** — it unblocks everything else.

### B2 (High) — Check dispatch is over-abstracted and bespoke per check

A check call flows `resolveRunContext` → `buildReport` → `buildCheckRunnerContext`
(rebuilds a near-identical context field-by-field) → `CHECK_RUNNERS[check]`
(each entry re-derives config, branches on scope, resolves ignore globs via four
free helpers). `CheckContext` is an 11-field optional god-bag passed whole to
every check though `comments` needs only `readFile`. Adding a check = ~8 edit
sites across 5 files.

**Fix — the central refactor.** Replace it with a `CheckPlugin` registry. The
cross-pollination round produced a concrete, agreed contract:

```ts
type CheckOutcome =
  | { status: "ran"; findings: DriftFinding[] }
  | { status: "skipped"; reason: string };   // scope-N/A, missing binary, disabled

type CheckPlugin<C = unknown> = {
  id: DriftCheckId;
  usage: string;                              // CLI usage derives from the registry
  defaultConfig: C;
  parseConfig: (raw: unknown, keyPath: string) => C;   // each plugin owns its config block
  preflight?: (ctx: CheckRunContext) => string | undefined;  // returns a skip reason, or undefined
  run: (ctx: CheckRunContext, config: C) => CheckOutcome;     // never throws
};

const CHECK_PLUGINS = [duplicatesCheck, ghostFilesCheck, commentsCheck, suppressionsCheck];
```

`buildReport` becomes: build the run context **once**, then for each requested
plugin run `preflight` (folding in both `checkRunsForScope` *and* the duplicates
"unsupported extension" warning) and `flatMap` the outcomes. This collapses
`ALL_CHECKS` / `IMPLEMENTED_CHECKS` / `checkRunsForScope` / the four ignore-glob
helpers / `buildCheckRunnerContext` into the plugin definitions + one context
build. `parseChecksConfig` becomes a registry loop. CLI usage and the
"unknown check" error derive from the registry.

### B3 (High) — `exactOptionalPropertyTypes` conditional-spread noise

`...(x === undefined ? {} : { x })` appears **16×** in non-test code, and
`runner.ts:64-70` re-spreads the same optionals that `report-builder.ts:134-146`
spreads again. The idiom is the *correct* way to honor the strict flag; the
*volume* is the symptom. Mostly dissolved by B2 (build context once). For the
remainder prefer explicit-`null` modeling (as `PreparedRun.suppressionDiffRef`
already does) or a tiny `omitUndefined()` helper. **Do not** relax the strict
flag.

### Medium / Low (see detailed note)

- **Med-1** `harness-freshness` is a parallel mini-pipeline: a 4th copy of the
  "safe repo-relative reader" and a 2nd copy of the `WARN … — … / FIX:` renderer.
  Share one `formatFindingLines` renderer and one `safeRepoPath` reader factory.
- **Med-2** `schemaVersion` is the literal `1` at 6 sites with no constant —
  value and type can drift on a v2 bump. Add `DRIFT_SCHEMA_VERSION = 1 as const`.
  Decide a policy for `details` (today only `suppressions` populates it).
- **Med-3** Re-split the `duplicates`/`duplicates-runner` and
  `suppressions`/`suppressions-parse` pairs along a real responsibility axis once
  B1 removes the duplicated helpers (they were split purely for the line ceiling;
  `duplicates.ts:259-267` round-trips re-exports of symbols it imported).
- **Med-4** Two near-identical hand-rolled comment/string lexers
  (`comments.ts:86-170` vs `suppressions-parse.ts:58-142`) — highest *correctness*
  drift risk; an escape/template-literal fix won't propagate. Extract a shared
  `scanLine(line, state, visitor)` core.
- **Med-5** Duplicated `DriftAiError`→exit-2 try/catch in `runDriftAi`;
  `harness-freshness` bypasses it with a different error shape.
- **Low:** declarative per-option CLI parser; hand-rolled glob engine
  (`config.ts:124-152`) is a candidate dep if extracted; ghost-files tuning
  knobs (`WEAK_TOKENS`, `ENTRY_POINT_STEMS`) are module-private — surface via
  config if ghost-files tuning is prioritized; `intersection` is O(n²).

### Tests

Strong and behavior-focused. Gaps: **`chunks.ts` has no dedicated test** (the
`chunkIndex`/`chunkCount` math and `orderedChunkChecks` extras-ordering — and the
A3 mislabel — are only exercised indirectly); `report-output.ts`'s
json-without-output-path stderr branch deserves a focused test.

---

## Part C — Could someone use it as a standalone tool on other projects?

**Verdict: it already works on other projects today** — proven by pointing the
unmodified `scripts/drift-ai.ts` at a throwaway non-Musi git repo; all four
detectors, both scope modes, config auto-discovery, and JSON output fired
correctly. The `scripts/drift-ai/` directory imports nothing outside itself (no
`@musi/*`, no cross-package paths) and is already library-shaped (a wide public
API is re-exported from `scripts/drift-ai.ts`). Roots/ignores/excludes/min-lines/
allowed-pairs are all config-driven. (Full coupling table + proof: 
`drift-ai-review/standalone-extraction.md`.)

The near-term support target is not "publishable npm package"; it is:

```sh
cd /path/to/pnpm-or-other-target-repo
bun /home/node/tmp/ai_devx_stuff/scripts/drift-ai.ts --scope current
```

or the same behavior through a thin wrapper that changes into the target repo. In
that model Bun belongs to the tools checkout, not the target repo. Node execution
of drift:ai itself is a later distribution concern.

Prefer the wrapper / documented `cd` flow as the MVP. A real `--repo <path>`
option is useful later, but it is a broader path-semantics pass: Git commands,
config discovery, `--output`, `--chunk-dir`, root validation, and subprocess cwd
all need one coherent target-root policy.

Three blockers stand between today's state and clean tool-checkout portability,
none fatal:

| Blocker | Detail | Fix |
|---|---|---|
| **C1 — target repo selection** | The CLI analyzes the current Git repo. `--root` means source root inside that repo, not "repo to scan." | Document or ship a wrapper for `cd <target-repo> && bun <tools>/scripts/drift-ai.ts` first. Add `--repo <path>` later only with explicit rules for Git, config, output, chunks, root validation, and subprocess cwd. |
| **C2 — jscpd bin resolution** | `defaultJscpdRunner` resolves `<analyzedRepoRoot>/node_modules/.bin/jscpd` with `cwd=analyzedRepoRoot` (`duplicates-runner.ts:52,73`). A pnpm target repo should not need to install `jscpd` just because the external tool uses it. | **Split the single `repoRoot` into two concepts:** `analyzedRepoRoot` stays as subprocess `cwd`; `toolRoot` / `jscpdBin` points at the tools checkout's `node_modules/.bin/jscpd` (or `import.meta.resolve` result). Fallback to target-local `.bin`, then a `--jscpd-bin` override. Keeping `cwd` = target repo is still required because jscpd report paths must remain repo-relative. |
| **C3 — Musi-isms in portable output** | (a) `harness-freshness` hardcodes `docs/ai-harness.md` + `docs/guides`; (b) ghost-files FIX hints embed `bun run code:intel`; (c) Musi's committed config has Musi roots. | Keep `harness-freshness` as a Musi-only plugin, **out of the portable default set**. Move FIX-hint text to config or generic wording. Add a generic starter config for TS/pnpm projects and document `--root`. |

**Recommended packaging for now:** keep a Bun-run tools checkout as the primary
distribution shape. The `CheckPlugin` registry (B2) still matters: the portable
core is the plugin loop + config + scope/git + report-format, and "what's
portable" reduces to "what's in the default plugin array." `harness-freshness`
is currently a special-cased `argv` branch (`runner.ts:82`), not a check — the
registry turns the Musi boundary into a one-line distinction. A standalone
Node/npm package remains a later option once the tool-checkout workflow is stable.

---

## Part D — What other checks should we add? (web research)

The decisive move was auditing what the repo **already gates** before
recommending anything. Complexity (`complexity: max 10`), function length
(`max-lines-per-function`), magic numbers, tests-without-assertions, leftover
TODOs/stub-errors (`local/no-llm-artifacts`), swallowed errors
(`local/no-swallowed-errors`), and dead exports (`knip` + `sensor:knip`) are
**all already ERROR-gated by ESLint/knip** — every one verified present. Adding
any of them as a report-only check would be a strictly *weaker* duplicate. That
disqualifies most generic "code smell" ideas. (Full ranked table of 17
candidates + sources: `drift-ai-review/additional-checks-research.md`.)

The literature is consistent that **duplication is the #1 measured AI-drift
signal** (GitClear: ~8× clone growth, copy-paste overtook refactoring in 2024;
OX Security: duplicated patterns in 80–90% of AI code). drift:ai already owns
that surface — but jscpd is *exact/token* clone detection, and AI mostly
produces *near*-clones (renamed vars, reordered statements).

**Recommended new checks, ordered for single-report value + tool-checkout
portability:**

1. **Import cycles — add first.** Prefer a tool-checkout dependency or
   already-available JS implementation (`madge --circular --json`, or the
   existing `eslint-plugin-import-x`'s `no-cycle`) and run it with the target repo
   as cwd. Circular imports are a concrete defect AI introduces when it splits a
   module and the helper re-imports its parent. The repo's own scope doc already
   named cycles as belonging to "a separate slow drift sensor"; the 2026-05-29
   roadmap makes drift:ai that single-report sensor. Before implementation, write
   acceptance cases for `tsconfig` path aliases, type-only imports, barrel files,
   and monorepo package boundaries.
2. **Orphaned/never-imported files — add if single-report consolidation is the
   goal.** `knip` already detects unused *files*; surfacing them inside the one
   drift report (and chunked handoff) adds value now that the desired direction is
   one report. Implementation should be dependency-aware: use target-local knip
   when the target has a tuned config, otherwise skip with a reason instead of
   pretending the tools checkout's generic config is authoritative.
3. **Near-duplicate functions — add after the report/dependency model is stable,
   via the `ts-morph` fallback.**
   `ts-morph` (28.x, already a dep) fingerprints functions (normalize
   identifiers, hash AST shape, compare within a token-count band) and catches
   the bulk of AI near-clones with **zero target-repo dependency** when bundled in
   the tools checkout.
   The higher-fidelity `similarity-ts` (Rust/`cargo install`, TSED) is **hostile
   to a portable tools checkout**, so keep it as an *optional* high-fidelity mode
   that activates only if the binary is present — never a hard dependency
   (exactly what the `CheckOutcome.skipped` path is for).

**Explicitly do NOT add.** The old flat "do NOT add" list conflated two different
reasons for exclusion. Split it three ways (this mirrors the adapter policy —
[`drift-ai-tasks/30-adapter-policy.md`](./drift-ai-tasks/30-adapter-policy.md) and
its contract [`drift-ai-tasks/03-adapter-contract.md`](./drift-ai-tasks/03-adapter-contract.md)):

- **Category 1 — do NOT reimplement as drift:ai heuristics.** Hand-rolled
  complexity / function-length / magic-number heuristics, inconsistent-naming
  beyond casing, large-diff. Do not bake these directly into the sensor. They
  *may* be surfaced when they come from an explicit `ai_devx_stuff-lint` baseline
  adapter (`--baseline-profile=ai_devx_stuff-lint`), because the operator
  explicitly asked to run shared generic AI-drift lint rules against the foreign
  repo — provenance-stamped `drift-baseline` so the reader knows drift:ai supplied
  the opinion.
- **Category 2 — may orchestrate via an adapter (provenance-stamped).** knip
  orphan-files *with the target's own config*, madge / import-x cycles honoring
  the target's tsconfig, similarity-ts opt-in near-duplicate, and lint adapters
  using either the target's config or the `ai_devx_stuff-lint` baseline. These are
  admissible because provenance identifies who owns the verdict (target-config /
  tool-default / drift-baseline). For *this* repo the normal verification stack
  stays canonical — `ai_devx_stuff-lint` is a shared *foreign-repo* inspection
  profile, not a claim the foreign repo opted into repo-specific standards.
- **Still excluded (unconditionally).** Secret/PII scanning (a *security* gate —
  use gitleaks/trufflehog separately, fail-the-build, wrong category for a
  report-only maintainability sensor); churn×complexity hotspots (slow, advisory,
  wrong altitude for a diff sensor — they belong in the `hotspots` subcommand,
  task 40); lockfile drift (drift:ai ignores lockfiles by design).

drift:ai's entire value rests on staying trustworthy, so the low-false-positive
bar is the gatekeeper for everything above.

---

## Prioritized roadmap

Sequenced so the first external-repo workflow is usable before the larger
architecture cleanup. Each step preserves the report-only contract.

### Track 1 — Portability MVP

1. **Tools-checkout contract.** Document the supported checkout shape: where the
   tools live, required `bun install`, owned dependencies such as `jscpd`, update
   flow, expected command surface, and target-repo assumptions. *(small)*
2. **Target wrapper / documented `cd` flow.** Prefer a wrapper that changes into
   the target repo and invokes `bun <tools>/scripts/drift-ai.ts`. Defer a true
   `--repo <path>` option until output/chunk/config/root path semantics are
   designed together. *(small)*
3. **Split `jscpd` executable from target cwd.** Resolve the executable from the
   tools checkout first, fall back to target-local `.bin`, then support
   `--jscpd-bin`; keep subprocess `cwd` as the target repo. Update the user-facing
   missing-binary hint at the same time. *(small)*
4. **Portable output cleanup.** Move the `code:intel` FIX hint to generic text or
   config, keep `harness-freshness` out of the portable default surface, and add a
   generic starter config for TS/pnpm projects. *(small)*

### Track 2 — Architecture and single report

5. **Share helpers — `path-util.ts` (B1).** Mechanical, removes a real
   correctness-drift risk, unblocks the broader refactor. *(small)*
6. **`CheckPlugin` registry + `CheckOutcome` union (B2).** The keystone:
   dissolves B3, fixes A4, and is the enabler for new checks and adapters. Bump
   `schemaVersion`; upgrade `skippedChecks` to `{check, reason}[]` (Med-2).
   *(medium)*
7. **Reporting trust pass (A1–A5).** Findings-first JSON + `scopeCount`,
   findings summary, chunk-label fix, skip-reason rendering, same-file-clone
   label. Add a `chunks.ts` test. *(small–medium)*
8. **Import-cycles plugin (D1).** First new structural check; prove target-aware
   module resolution, type-only edge handling, barrel behavior, and monorepo
   package-boundary handling before treating findings as high confidence.
   *(small–medium)*
9. **External adapter policy + knip orphan-files adapter.** Adapters may emit
   findings only when target-local config/module resolution is available; otherwise
   they must skip with a reason. Start with `knip` unused-file/orphan-file
   surfacing. *(small)*
10. **Near-duplicate plugin via `ts-morph`;** `similarity-ts` as optional
    high-fidelity mode. *(medium)*
11. **Optional Node/npm extraction.** Add `tsc`→`dist`, a Node bin, package docs,
    and npm-style dependency resolution if the tools-checkout workflow needs
    broader distribution. *(medium)*
12. **Opportunistic:** shared lexer (Med-4), shared renderer/reader for
    `harness-freshness` (Med-1), `--fail-on-findings` (A6), Low items.

## Decisions from follow-up discussion

1. **Portability target:** acceptable for the tool checkout to require Bun. The
   target repo may be pnpm/non-Bun and should not have to adopt Bun.
2. **Distribution target:** "works from `/home/node/tmp/ai_devx_stuff` / copied
   tools checkout" is enough for now. Node/npm publication is optional later.
3. **Report shape:** drift:ai should move toward a single drift report, with
   external checks/adapters represented as first-class plugins and skipped with
   reasons when their prerequisites are absent.
4. **Dependency ownership:** implementation dependencies like `jscpd` should be
   owned by the tools checkout when possible. The target repo should remain the
   subprocess cwd so scanner output remains repo-relative.
5. **Scope authority:** `drift-ai-current-scope.md` is historical for the landed
   current-mode v1. Its "no plugins / no import cycles / no unused files" non-goals
   are superseded for this follow-up roadmap.
