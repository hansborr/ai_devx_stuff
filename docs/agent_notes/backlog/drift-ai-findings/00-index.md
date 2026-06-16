# drift:ai findings — backlog

Status: Partially actioned — 9 tooling findings (01, 03, 04, 06, 11, 12, 13, 14, 16) implemented on `chore/driftai-audit`; 07 is a won't-fix false positive; the remaining 21 stay backlog.
Created: 2026-06-13
Source: a widest-net `drift:ai` audit of the repo (every check + every external
engine + every advisory lens), triaged by a dynamic multi-agent workflow.

Each file in this folder is **one self-contained, actionable issue**. The bar for
inclusion: it must either **fix a bug** or **improve code quality** (maintainability,
readability, reduced duplication, dead-code removal). We are only prepping the
backlog here — nothing in these issues has been actioned.

Per the audit weighting, **tooling / dogfood code** (`scripts/**`, `scripts/drift-ai/**`,
`eslint-rules/**`) — i.e. the drift:ai tool itself — is prioritized over product
code (`packages/**/src`).

## How this was produced

1. **Run battery** — `drift:ai --check all` (1713 raw findings) plus every advisory
   lens (hotspots, ownership, clone/dolos clones, class-construction, …) and every
   external engine (Semgrep live-registry security packs, Dolos, coverage).
2. **Triage workflow** — ~24 agents classified each finding against the bar, opening
   the cited code; one synthesis agent per theme deduped the heavily-overlapping
   duplication/dead-code signals (1713 → 40 candidates → 31 issues).
3. **Adversarial verify** — a skeptic tried to refute every bug / dead-code / cycle /
   security claim; 0 survived as false. A second re-verification ran while drafting
   each file.
4. **Post-triage review (parallel Codex pass + first implementation pass, 2026-06-13)** —
   an independent Codex review and an implementation pass re-checked every finding
   against the live tree. One survived as a **false positive**: finding 07, whose
   proposed fix violates lint-ratchet's *enforced* portable runtime import boundary
   (`scripts/tests/test-lint-ratchet.sh`). A few docs carried minor inaccuracies
   (09 title, 10 `runByDefault` caveat, 13 test path) that have been corrected in
   place. Each affected finding now carries a "Review verdict" note. In this branch the
   low-risk tooling findings **01, 03, 04, 06, 11, 12, 13, 14, 16** were implemented
   (see commits on `chore/driftai-audit`); the remaining findings stay backlog. Each
   implemented finding's `Status:` line now says so, and its body is preserved as the
   original finding (cited line numbers predate the fix). Finding 16 additionally records a
   residual naming follow-up — its dedup target `MaxLinesRatchetPolicy` is, after 03,
   consumed only by non-max-lines builders — for a future cleanup.

## What was examined and cleared (no issue filed)

- **Security (Semgrep, 41 candidate groups)** — all triaged as false-positive or
  intentional: non-literal regexps built from constants (no ReDoS), `redis://` for
  local/in-cluster transport, `.replace` vs `.replaceAll` style, Claude-Code hook
  rules on internal hook config. **No exploitable finding.**
- **Import cycles (19)** — all `import type`-only; none is a runtime defect.
- **env-branches** — 0 (product code branches on no build-time env constant).
- **Churn / ownership / coldspots** — context only, no actionable code-quality issue.

A handful of recurring detector false-positive classes are captured as optional
tuning in [`detector-noise-tuning.md`](./detector-noise-tuning.md).

## Tooling / dogfood issues (20)

| # | Issue | Area | Severity | Size | Confidence |
|---|---|---|---|---|---|
| 01 ✅ | [lint-ratchet-baseline-parse.ts re-declares JSON helpers already exp…](./01-lint-ratchet-baseline-parse-json-helpers-dup.md) | tooling | quality-high | XS | high |
| 02 | [drift-ai coldspots/hotspots families duplicate loadBaseline, newest…](./02-drift-ai-coldspots-hotspots-shared-helpers-dup.md) | tooling | quality-high | M | high |
| 03 ✅ | [7 dead exported functions: 4 orphaned ratchet builders, 2 abandoned…](./03-drift-tooling-dead-exported-functions.md) | tooling | quality-med | S | high |
| 04 ✅ | [Identical unwrapExpression ts-morph helper duplicated in overview-c…](./04-code-intel-unwrap-expression-dup.md) | tooling | quality-med | XS | high |
| 05 | [dolos-output and semgrep-output duplicate the CLI --version parser …](./05-drift-ai-tool-version-parser-dup.md) | tooling | quality-med | S | high |
| 06 ✅ | [DAEMON_FALLBACK_ERROR_NAME hard-coded in daemon-server.ts though da…](./06-code-intel-daemon-fallback-error-name-dup.md) | tooling | quality-med | XS | med |
| 07 | [⚠ FALSE POSITIVE — HARNESS_DIAGNOSTICS_OUTPUT env-var dedup crosses the portable boundary](./07-harness-diagnostics-output-env-dup.md) | tooling | false-positive | XS | n/a |
| 08 | [Doc-generator check-or-write scaffold (parseArgs/readCurrentOutput/…](./08-harness-doc-generator-scaffold-dup.md) | tooling | quality-med | S-M | med |
| 09 | [lint-agent re-declares ESLint-JSON types and parseEslintOutput alre…](./09-lint-eslint-output-parser-dup.md) | tooling | quality-med | S-M | med |
| 10 | [Six empty-config check-config metadata literals (and the duplicate-…](./10-drift-ai-empty-check-config-factory.md) | tooling | quality-med | S | low |
| 11 ✅ | [config.ts re-exports 5 symbols no consumer pulls through the barrel](./11-config-barrel-dead-passthroughs.md) | tooling | quality-low | XS | high |
| 12 ✅ | [check-metadata.ts exports DriftAiCheckMetadata type that nothing re…](./12-check-metadata-dead-type-alias.md) | tooling | quality-low | XS | high |
| 13 ✅ | [ResolveJscpdBinOptions / ResolveKnipBinOptions re-declare ResolveTo…](./13-drift-ai-bin-options-redeclared-types.md) | tooling | quality-low | XS | high |
| 14 ✅ | [BirthSizeDeltaComplexityFunction re-declares the exported BranchPoi…](./14-drift-ai-branch-point-function-type-dup.md) | tooling | quality-low | XS | med |
| 15 | [expand-barrel codemod over-exports module-internal helpers and unio…](./15-expand-barrel-codemod-over-exports.md) | tooling | quality-low | XS | med |
| 16 ✅ | [RatchetFamilyScope privately re-declares the exported MaxLinesRatch…](./16-lint-ratchet-family-scope-type-dup.md) | tooling | quality-low | XS | med |
| 17 | [rows-per-section PrototypeCap builder duplicated across coverage-ev…](./17-drift-ai-advisory-rows-per-section-cap-dup.md) | tooling | quality-low | S | med |
| 18 | [trpc-shared codemods redefine CODEMOD_NAME, and the twin trpc-share…](./18-trpc-shared-codemod-name-and-eslint-helper-dup.md) | tooling | quality-low | S | med |
| 19 | [Recursive readdirSync directory-walk duplicated across four codemod…](./19-codemod-recursive-dir-walk-dup.md) | tooling | quality-low | S-M | med |
| 20 | [drift-ai facade modules re-export companion-type surfaces no consum…](./20-drift-partial-facade-type-reexports.md) | tooling | quality-low | S | low |

## Product issues (11)

| # | Issue | Area | Severity | Size | Confidence |
|---|---|---|---|---|---|
| 21 | [encounter-state-mutations.ts header says three write shapes, lists …](./21-encounter-mutations-header-undercounts-write-shapes.md) | product | quality-med | XS | high |
| 22 | [Three near-identical capped multi-select checkbox groups across hom…](./22-client-homebrew-capped-checkbox-group-dup.md) | product | quality-med | S-M | med |
| 23 | [useFogMutations and useDrawingMutations are the same map-layer muta…](./23-client-map-layer-mutations-hook-dup.md) | product | quality-med | S | med |
| 24 | [tRPC mutation inject-assert-unwrap boilerplate (~14 copies) repeate…](./24-server-test-trpc-mutation-inject-helper-dup.md) | product | quality-med | S-M | med |
| 25 | [collections/MODULE.md cites ../../lib; correct depth is ../../../lib](./25-collections-module-doc-wrong-lib-relative-depth.md) | product | quality-low | XS | high |
| 26 | [FakeTRPCError test class copy-pasted byte-identically across 5 vtt-…](./26-client-fake-trpc-error-test-class-dup.md) | product | quality-low | XS | med |
| 27 | [worktreeTestDatabaseSlug DB-naming parser duplicated verbatim acros…](./27-server-worktree-test-db-slug-parser-dup.md) | product | quality-low | XS | med |
| 28 | [AssertTurnLockOpts duplicates the documented cross-module AssertTur…](./28-server-assert-turn-opts-type-dup.md) | product | quality-low | XS | med |
| 29 | [characterSpellSlotSchema and spellSlotResultSchema are byte-identic…](./29-shared-spell-slot-schema-dup.md) | product | quality-low | XS | low |
| 30 | [BYTES_PER_MB defined twice within the upload feature (route already…](./30-server-bytes-per-mb-constant-dup.md) | product | quality-low | XS | low |
| 31 | [spells-by-level grouping (and the EmptyState/ErrorState list cards)…](./31-client-spells-by-level-grouping-dup.md) | product | quality-low | S-M | low |

## Severity legend

- **bug** — a real defect/risk (none found in this pass).
- **quality-high / -med / -low** — code-quality improvement (dedup, dead-code,
  readability), ranked by payoff vs. churn.
- **Size** — XS (a few lines) · S · S-M · M · M-L · L.
- **✅ (beside the #)** — implemented on `chore/driftai-audit` (2026-06-13); see that finding's `Status:` line.

_Total: 31 issues (20 tooling, 11 product). No `bug`-severity findings. Post-review: 1
false positive (07). Of the remaining 30 quality improvements, 9 tooling findings (01, 03,
04, 06, 11, 12, 13, 14, 16) are implemented on `chore/driftai-audit`; 21 remain backlog._
