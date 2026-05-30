# drift:ai — Additional Checks Research (web)

Research task: identify well-regarded checks/heuristics that catch AI-introduced
code drift or general maintainability rot, and judge which are worth adding to
`drift:ai`. drift:ai is **report-only**, runs on changed files (vs `main`) or
whole-repo (`--scope current`), is TypeScript/JS-focused, config-driven, and
shells out to existing tools where it can (today: `jscpd` for `duplicates`).

Update, 2026-05-29: follow-up discussion clarified the delivery shape. The first
external use case is a shared Bun-powered tools checkout scanning another Git
repo, including pnpm projects. The target repo should not need to adopt Bun or
install drift:ai implementation dependencies just to be scanned. The user also
prefers drift:ai becoming a single drift report, so low-risk external adapters
are more valuable than they were under the original "keep every sensor separate"
framing.

The hard constraint, repeated in the existing scope doc and visible in the
detector calibration, is **trustworthiness through low false positives**. A
report-only sensor that cries wolf gets ignored. Every candidate below is judged
primarily on signal-to-noise, then on implementation cost.

## Critical context: what this repo ALREADY enforces (de-dup against existing tooling)

Before recommending anything, I audited what the repo already gates. Several
"obvious" AI-drift checks are **already hard-enforced by ESLint or knip**, so
adding them to drift:ai would be pure redundancy (and worse — drift:ai is
report-only, so it would be a *weaker* duplicate of a build-gating rule):

| Candidate signal | Already covered by | Where |
|---|---|---|
| Cyclomatic complexity | `complexity: ["error", { max: 10 }]` | `eslint-config/rule-groups.js:25` |
| Function length | `max-lines-per-function` (max 200) + custom `local/max-lines` | `eslint-config/rule-groups.js:11`, `eslint-rules/max-lines.js` |
| Magic numbers | `no-magic-numbers` | `eslint-config/rule-groups.js:29` |
| Tests without assertions | `vitest/expect-expect`, `playwright/expect-expect` | `eslint-config/test-configs.js:66,130` |
| Leftover TODOs / "…existing code…" / "not implemented" stubs | custom `local/no-llm-artifacts` | `eslint-rules/no-llm-artifacts.js` |
| Dead exports / unused files / unused deps | `knip` (`bun run sensor:knip`) | `knip.config.ts` |
| Duplicate eslint-disable directives | `eslint-comments/no-duplicate-disable` | `eslint-config/rule-groups.js:51` |
| Cross-package dependency leaks | `import-x/no-extraneous-dependencies` | `eslint-config/package-dependency-configs.js` |
| Exact/token-level duplicate blocks | drift:ai `duplicates` (jscpd) | `scripts/drift-ai/duplicates.ts` |
| Over-narration (comment ratio) | drift:ai `comments` | `scripts/drift-ai/comments.ts` |
| New suppression comments | drift:ai `suppressions` | `scripts/drift-ai/suppressions.ts` |
| Ghost sibling modules | drift:ai `ghost-files` | `scripts/drift-ai/ghost-files.ts` |

The original current-scope v1 doc stated an explicit non-goal:

> Do not make claims about dead exports, import cycles, or unused files; those
> belong to a separate slow drift sensor.

That was the correct boundary for landing current mode. The 2026-05-29 follow-up
roadmap intentionally supersedes it for future work: drift:ai is now the
candidate single drift report, so import cycles and adapter-backed orphan-file
surfacing are in scope if they preserve the low-false-positive contract. Dead
exports remain out because `knip` already owns them.

This audit alone disqualifies the majority of generic "code smell" checks. What
remains worth adding are checks that are (a) cross-file / structural, (b) hard
for a single-file ESLint rule to see, and (c) not already covered by a stronger
gate, except when the value is explicitly single-report surfacing of a
target-configured external tool.

## Why duplication is the highest-value AI-drift signal (and where jscpd falls short)

The strongest empirical signal across the 2024–2026 literature is **duplication**:

- GitClear analyzed 211M lines (2020–2025): duplicated code blocks (5+ lines)
  increased **~8x** in 2024; copy/pasted lines rose 8.3% → 12.3%; "moved"
  (refactored) lines fell 24.1% → 9.5%; copy-paste **exceeded** refactoring for
  the first time in 2024. Cloned blocks correlate with 15–50% more defects.
- OX Security (300 repos, Oct 2025): "duplicated bug patterns across files"
  appears in 80–90% of AI code; "Comments Everywhere" 90–100%; "Over-
  Specification" (hyper-specific single-use code instead of reuse) 80–90%.

drift:ai's `duplicates` already targets this — but jscpd is **token/exact**
clone detection. AI most often produces **near-clones**: the same logic with
renamed variables, reordered statements, or a slightly different signature. That
is precisely the gap `similarity-ts` (AST/TSED structural similarity) closes.
This makes "near-duplicate functions" the single most defensible addition.

## Candidate table

Verdict legend: **Strong add** / **Maybe** / **Skip**. "Cost" assumes this
TS/bun codebase and the existing shell-out-to-tool pattern (jscpd). The table
keeps the original signal-strength ranking; the recommended implementation order
below also accounts for the later single-report and tools-checkout portability
decisions.

| # | Check | Catches | Tooling & maturity | FP risk | Impl. cost here | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Near-duplicate functions** | AST-similar functions (renamed vars, same logic) that jscpd's token matcher misses — the dominant AI duplication pattern | `similarity-ts` (mizchi, Rust, AST + TSED, bloom-filter fast mode, default threshold 0.85); `jsinspect` (JS, AST, unmaintained) | Low–Med. Threshold-tunable; can be noisy on tiny functions, mitigated by `--min-lines`/min-tokens | Med. New tool, **Rust/cargo binary** (not npm) — breaks the "npm devDep like jscpd" pattern; needs a runner + binary-presence guard + graceful skip. Could vendor a prebuilt binary or gate behind availability | **Strong add** |
| 2 | **Import cycles** | Circular `import` graphs (A→B→A) that AI introduces when it adds a helper that re-imports its parent; cause init-order/test-flakiness bugs | `dependency-cruiser` (rules + JSON, mature, CI-grade), `madge --circular` (lighter, JS/TS), or `import-x/no-cycle` (already-installed ESLint plugin!) | Low. Cycles are unambiguous; near-zero FPs once barrels/types are handled | **Low**. `eslint-plugin-import-x` is already a dep — `import-x/no-cycle` could even be read via a focused run; or shell to `madge --circular --json`. The original current-scope non-goal left this to a separate slow sensor; the 2026-05-29 roadmap makes drift:ai that report surface | **Strong add** |
| 3 | **Orphaned / never-imported files** | Whole source files not imported anywhere (not just unused exports) — AI commonly leaves a created-then-abandoned module | `knip` (already a devDep; reports unused *files* distinct from unused exports) | Low–Med. knip FPs come from missed entry points/dynamic imports; repo's `knip.config.ts` is already tuned | **Low**. knip is installed and configured (`sensor:knip`). drift:ai could parse `knip --reporter json` for the *files* category only, in `--scope current`. Overlaps the existing non-goal, so frame as report-only surfacing of knip's file findings | **Maybe** (mostly redundant with `sensor:knip`; only adds value if unified into one drift report) |
| 4 | **Over-defensive code** | Empty/silent `catch {}`, catch-and-rethrow noise, redundant try/catch wrappers — a named AI anti-pattern (silent error absorption) | Partly `local/no-swallowed-errors` (exists!); broader heuristic would be custom AST via `ts-morph` (already a dep) | Med–High. "Defensive" is subjective; high FP risk distinguishing real guards from noise | Med (custom AST). But **`local/no-swallowed-errors` already covers the high-signal core** | **Skip** (core already an ESLint rule; the rest is too subjective for a low-FP sensor) |
| 5 | **Cyclomatic / cognitive complexity** | Over-complex functions | `eslint` `complexity`, `eslint-plugin-sonarjs` `cognitive-complexity` | Low | n/a | **Skip** — `complexity: max 10` already ERROR-gated |
| 6 | **Function length / file size** | Bloated functions/files | `max-lines-per-function`, custom `local/max-lines` | Low | n/a | **Skip** — already ERROR-gated + ratcheted |
| 7 | **Magic numbers** | Unnamed numeric literals | `no-magic-numbers` | Med | n/a | **Skip** — already ERROR-gated |
| 8 | **Tests without assertions** | Tests that never `expect` | `vitest/expect-expect`, `playwright/expect-expect` | Low | n/a | **Skip** — already ERROR-gated |
| 9 | **Leftover TODOs / edit-note artifacts / stub errors** | "…existing code…", untracked TODO, `throw new Error("not implemented")` | custom `local/no-llm-artifacts` | Low | n/a | **Skip** — already ERROR-gated |
| 10 | **Dead/unused exports** | Exported-but-unused symbols | `knip`, `ts-prune` (archived 2025), `ts-unused-exports` | Med (dynamic imports) | n/a | **Skip** — `knip` already installed + scoped; ts-prune/depcheck archived |
| 11 | **Hallucinated / unused imports** | Imports of non-existent or unused modules | TS compiler / `eslint` `no-unused-vars`; non-existent imports fail typecheck | Low | n/a | **Skip** — typecheck + lint already catch both classes |
| 12 | **Secret / PII leakage** | Hardcoded API keys, tokens, PII in diffs | `gitleaks` (regex, fast, pre-commit), `trufflehog` (entropy + live verification) | Low (trufflehog verifies) / Med (gitleaks) | Med (new binary) | **Skip for drift:ai** — this is a *security* gate, not maintainability drift; belongs in its own pre-commit/CI step with gitleaks, not in a report-only quality sensor |
| 13 | **Churn × complexity hotspots** | Files with high git-churn *and* high complexity = refactor ROI targets | `code-maat`, `code-forensics`, `code-hotspots` | Low signal, but heavy interpretation | High (git-log mining, JVM tool) | **Skip** — slow, needs history mining, output is advisory not actionable per-diff; wrong altitude for a diff sensor |
| 14 | **Architecture / layering violations** | `client` importing `server` internals, skipping the shared contract | `dependency-cruiser` custom rules | Low | Med (rule authoring) | **Maybe (later)** — real value for this monorepo's `shared→server→client` flow, but partly covered by `import-x/no-extraneous-dependencies` and package boundaries; defer until cycles land |
| 15 | **Inconsistent naming** | Mixed camel/snake, helper naming drift | none mature/low-FP for TS | High | High (custom, heuristic) | **Skip** — inherently noisy, no trustworthy signal |
| 16 | **Large diffs** | Oversized single commits | git stat threshold | High (legitimate big changes) | Low | **Skip** — crude proxy, not a quality signal; noise |
| 17 | **package-lock / `bun.lock` drift** | Lockfile changed without manifest change, or vice versa | custom git check | Low | Low | **Skip** — drift:ai already *ignores* lockfiles by design (`DEFAULT_IGNORE_FILES`); this is a CI manifest-consistency concern, not AI code drift |

## Recommended next checks to add

### 1. Import cycles (`import-cycles`) — Strong add, lowest cost, near-zero FP

**Why:** Circular imports are a concrete, unambiguous defect class AI introduces
when it splits a module and the new helper re-imports its parent (the same
behavior `ghost-files` already worries about, one level deeper). Cycles cause
init-order bugs and test flakiness, and they have **near-zero false positives**
once barrel/type-only edges are handled. The original current-scope non-goal
named "import cycles" as belonging to "a separate slow drift sensor"; the
2026-05-29 roadmap makes drift:ai that report surface.

**Implementation note:** This should be the first new plugin after the registry:
it is a small, structural check that proves plugin preflight, JSON reporting, and
single-report rendering. Prefer a JS/npm-native implementation available in the
tools checkout (`madge --circular --json`, or a focused use of
`eslint-plugin-import-x`'s `no-cycle`) and run it with the target repo as cwd.
Changed-scope reporting should include cycles touching changed files; current
scope can report the whole graph.

Acceptance criteria before enabling by default:

- respects the target repo's `tsconfig` path aliases and package resolution;
- ignores or clearly labels type-only import cycles;
- handles barrel files without collapsing every barrel fan-out into noisy cycles;
- reports monorepo package-boundary cycles in a way that matches the target's
  package graph, not the tools checkout's dependencies.

### 2. Orphaned files surfaced via knip (`orphan-files`) — Add only as a single-report adapter

**Why:** AI frequently creates a module, wires nothing to it, and moves on. knip
already detects unused *files* (distinct from unused exports), and Musi already
has a tuned `sensor:knip` path. The value-add is **unification**: surfacing
target-configured knip "unused files" findings inside the same report-only drift
run and chunked handoff.

**Caveat:** Do not replace knip or pretend a generic tools-checkout config is
authoritative for every target. The plugin should prefer target-local knip/config
when available; otherwise emit a skipped check with a reason. This is worth doing
because the product direction is now a single drift report. If that ever changes,
leave orphan/dead-file reporting to standalone knip.

General adapter policy: external adapters may emit findings only when target-side
configuration and module resolution are trustworthy. If the target has no config,
uses an unsupported package manager layout, or only the tools checkout has the
dependency installed, the adapter should skip with an explicit reason instead of
using generic defaults.

### 3. Near-duplicate functions (`similar-functions`) — Strong add, but after dependency/report shape

**Why:** Duplication is the #1 empirically-measured AI-drift signal (GitClear 8x;
OX 80–90%). drift:ai already owns the "duplication" surface via jscpd, but jscpd
is token/exact — it misses the AI-typical near-clone (same logic, renamed
variables, reordered lines). `similarity-ts` uses AST + Tree Structure Edit
Distance to catch exactly those, sorted by `lines × similarity` so the report
leads with the highest-impact pairs. This is the single addition that most
deepens drift:ai's existing strength.

**Implementation note (the one real cost):** For the tools-checkout target, use a
pure TypeScript implementation first: `ts-morph` is already available and can
fingerprint functions by normalized AST shape with conservative min-token/min-line
floors. `similarity-ts` is a Rust binary
(`cargo install similarity-ts`), not an npm package, so it breaks the
"tool checkout owns its dependencies" model. Keep it as an optional
high-fidelity mode that activates only if the binary is present and otherwise
skips cleanly. Keep the default threshold conservative (≥0.85) and a
min-lines/min-tokens floor to protect the low-FP contract. Report-only, like
every other check.

## Explicitly do NOT add

This used to be a flat list, but it conflated two genuinely different reasons for
exclusion: "do not hand-roll this heuristic in drift:ai" is not the same as "never
surface this at all." Split it three ways, in line with the adapter policy
(`../drift-ai-tasks/30-adapter-policy.md` and its contract
`../drift-ai-tasks/03-adapter-contract.md`).

### Category 1 — do NOT reimplement as drift:ai heuristics

- **Complexity, function-length, magic-numbers, inconsistent-naming beyond
  casing, large-diff, tests-without-assertions, leftover-TODOs, dead exports,
  unused/hallucinated imports.** Do not hand-roll these inside the sensor — for
  *this* repo they are already hard-gated by ESLint or knip, and a report-only
  re-implementation would be a strictly weaker duplicate that dilutes the report.
- They **may** be surfaced for a *foreign* repo via an explicit
  `ai_devx_stuff-lint` baseline adapter (`--baseline-profile=ai_devx_stuff-lint`),
  because the operator explicitly asked to run shared generic AI-drift lint rules
  there. Such findings are provenance-stamped `drift-baseline` so the reader knows
  drift:ai supplied the opinion (Tier-2 — see the adapter contract).

### Category 2 — may orchestrate via an adapter (provenance-stamped)

- **knip orphan-files** with the target's own config (task 32, Tier-1
  pass-through), **madge / import-x cycles** honoring the target's tsconfig (task
  31), **similarity-ts** opt-in near-duplicate (task 33), and **lint adapters**
  using either the target's own config or the `ai_devx_stuff-lint` baseline. These
  are admissible because provenance identifies who owns the verdict
  (`target-config` / `tool-default` / `drift-baseline`). Local CI stays canonical
  for *this* repo; `ai_devx_stuff-lint` is a *foreign-repo* inspection profile, not
  a claim the foreign repo opted into repo-specific standards.

### Still excluded (unconditionally)

- **Secret/PII scanning.** Real and important, but it is a *security* gate
  (gitleaks/trufflehog, fail-the-build) — wrong tool category for a report-only
  maintainability sensor; keep it separate.
- **Churn×complexity hotspots.** Not an `ai` check — they belong in the `hotspots`
  subcommand (`../drift-ai-hotspots-subcommand.md`; task 40), the wrong altitude
  for a diff sensor.
- **Lockfile drift.** Out of scope by design (drift:ai deliberately ignores
  lockfiles).
- **Over-defensive-code heuristic** beyond the existing `local/no-swallowed-errors`
  rule — too subjective to keep false positives low.

## Sources

- [OX Report: AI-Generated Code Violates Engineering Best Practices (PRNewswire)](https://www.prnewswire.com/news-releases/ox-report-ai-generated-code-violates-engineering-best-practices-undermining-software-security-at-scale-302592642.html)
- [Understanding Anti-Patterns and Quality Degradation in AI-Generated Code (SoftwareSeni, summarizing OX)](https://www.softwareseni.com/understanding-anti-patterns-and-quality-degradation-in-ai-generated-code/)
- [AI writes code like a junior dev, and security is feeling it (Help Net Security, on OX)](https://www.helpnetsecurity.com/2025/10/27/ai-code-security-risks-report/)
- [GitClear: AI Copilot Code Quality 2025 — 4x/8x growth in clones](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
- [Report Summary: GitClear AI Code Quality Research 2025 (jonas.rs)](https://www.jonas.rs/2025/02/09/report-summary-gitclear-ai-code-quality-research-2025.html)
- [AI-Generated Code Is Building Tech Debt You Can't See (dev.to)](https://dev.to/klement_gunndu/ai-generated-code-is-building-tech-debt-you-cant-see-khn)
- [What Is AI Slop? Detect & Prevent Low-Quality AI Code (Larridin)](https://larridin.com/developer-productivity-hub/what-is-ai-slop-detect-prevent-low-quality-ai-code)
- [How to Avoid AI Code Slop (Aviator)](https://www.aviator.co/blog/how-to-avoid-ai-code-slop/)
- [Debugging AI-Generated Code: 8 Failure Patterns & Fixes (Augment Code)](https://www.augmentcode.com/guides/debugging-ai-generated-code-8-failure-patterns-and-fixes)
- [Detecting Duplicated Code Scattered by AI and Humans with similarity-ts (mizchi, Zenn)](https://zenn.dev/mizchi/articles/introduce-ts-similarity?locale=en)
- [similarity-ts / mizchi/similarity (GitHub)](https://github.com/mizchi/similarity)
- [jsinspect — detect copy-pasted and structurally similar code (GitHub)](https://github.com/danielstjules/jsinspect)
- [Knip — Comparison & Migration (vs ts-prune, depcheck, ts-unused-exports)](https://knip.dev/explanations/comparison-and-migration)
- [Knip — Unused exports docs](https://knip.dev/typescript/unused-exports)
- [ts-prune (GitHub — maintenance mode)](https://github.com/nadeesha/ts-prune)
- [dependency-cruiser (npm)](https://www.npmjs.com/package/dependency-cruiser)
- [Dependency Cruiser vs. Madge (GitHub issue #203)](https://github.com/sverweij/dependency-cruiser/issues/203)
- [Automate Circular Dependency Detection in Node.js (Medium)](https://sanyamaggarwal.medium.com/automate-circular-dependency-detection-in-your-node-js-project-394ed08f64bf)
- [eslint-plugin-sonarjs — cognitive-complexity rule](https://github.com/SonarSource/eslint-plugin-sonarjs/blob/master/docs/rules/cognitive-complexity.md)
- [ESLint complexity rule](https://eslint.org/docs/latest/rules/complexity)
- [eslint-plugin-jest — expect-expect rule](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/expect-expect.md)
- [Vitest — Writing Tests with AI](https://main.vitest.dev/guide/learn/writing-tests-with-ai)
- [TruffleHog vs. Gitleaks: A Detailed Comparison (Jit)](https://www.jit.io/resources/appsec-tools/trufflehog-vs-gitleaks-a-detailed-comparison-of-secret-scanning-tools)
- [gitleaks (GitHub)](https://github.com/gitleaks/gitleaks)
- [code-maat (GitHub)](https://github.com/adamtornhill/code-maat)
- [Focus refactoring on what matters with Hotspots Analysis (Understand Legacy Code)](https://understandlegacycode.com/blog/focus-refactoring-with-hotspots-analysis/)
