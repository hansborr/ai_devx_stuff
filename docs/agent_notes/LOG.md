# Log

Curated recent history. Do not use this file as an archive for every landed
task; keep only entries that help orient future sessions.

Newest on top.

---

## 2026-05-31 — Parallel sibling-cancellation mitigation (Phases 1 + 2E)

Shipped two Claude-only nudges that re-inject one calm pointer when the upstream
parallel-cancel bug (claude-code#22264) cascades sibling Bash calls. Phase 1:
`no-direct-db.sh` appends an inoculation suffix to hard-block reasons (new
Claude-only `scripts/ai-hooks/claude-guidance.sh`; shared `ai_emit_block` /
Codex output untouched). Phase 2E: new `.claude/hooks/parallel-cancel-note.sh`
on `PostToolBatch` injects the same wording once per batch when a real cancelled
sibling is present (detection keyed to the wrapped marker at the absolute start
of `tool_response` — `\A<tool_use_error>Cancelled…` — to avoid false-firing on
docs/block-reasons that merely quote the phrase). Phase 3 (Stop scan) not needed:
Phase 0 proved `PostToolBatch` delivers `additionalContext` same-turn. Durable
detail in `decisions-build.md` and `finished_work/parallel-cancel-guidance-hook.md`;
backlog brainstorm marked superseded. Gates: `bash scripts/ai-hooks/test.sh`,
`shellcheck --severity=warning`, `bun run verify:changed`.
## 2026-05-31 — Drift:ai duplicate AST source cache

Completed drift-ai review task 34. Duplicate-types, duplicate-schemas,
duplicate-literals, and duplicate-constants now share a report-scoped parsed
source cache created by `buildReport`; the duplicate-shape runner still applies
each check's effective `excludeGlobs` after shared collection so per-check
filters do not leak.

Validation: focused duplicate-shape/type/schema/literal/constant Vitest and
`drift:ai --scope current --root scripts/drift-ai --check all` (existing
findings; knip-backed checks timed out and skipped after 600000ms).

---

## 2026-05-31 — Drift:ai typed duplicate-shape extras

Completed drift-ai review task 37. The duplicate-shape core now carries a
generic extractor payload type through collection, grouping, finding building,
and check execution. Type, schema, literal, and constant extractors export their
payload contracts, and check wrappers read those fields directly via a shared
first-member helper instead of defensive fallback lookups.

Validation: focused duplicate-shape/type/schema/literal/constant Vitest,
scripts `tsc`, and `drift:ai --scope current --root scripts/drift-ai --check all`
(existing findings; knip-backed checks timed out and skipped after 600000ms).

---

## 2026-05-31 — Drift:ai shared knip check wiring

Completed drift-ai review task 36. `orphan-files` and `unused-exports` now use a
shared knip pass-through check helper for service resolution, config/install
preflight, runner lookup, subprocess failure mapping, unreadable-JSON diagnostics,
and provenance handoff. The check wrappers now own only their parser and finding
builder callbacks.

Validation: focused knip pass-through/orphan-files/unused-exports/runner Vitest
and root `bun run typecheck`.

---

## 2026-05-31 — Drift:ai knip optional symbol locations

Completed drift-ai review task 33. The unused-exports adapter no longer
fabricates `file:0:0` evidence for malformed knip symbol coordinates; invalid or
incomplete locations now render as file-only symbol findings, and structured
details include `line`/`col` only when both are positive integers.

Validation: focused `knip-unused-exports` Vitest.

---

## 2026-05-31 — Drift:ai coldspots baseline text tags

Completed drift-ai review task 29. Coldspots text output now renders the existing
per-row baseline deltas for both coldspot and stale-marker rows using the
hotspots tag vocabulary (`[↑NEW]`, `[↑+N]`, `[↓N]`, `[=steady]`). JSON output was
unchanged.

Validation: focused coldspots Vitest.

---

## 2026-05-31 — Drift:ai stale-marker dirty blame guard

Completed drift-ai review task 27. The stale-marker lens now checks
marker-bearing files with `git status --porcelain --untracked-files=all --
<path>` before blame, skips dirty/untracked files so worktree line numbers are
not aged against `HEAD`, and discloses that those marker ages are unavailable.
Clean marker files in the same run still blame and qualify normally; dirty
age-unknown files do not pass the stale age gate from counts alone.

Review follow-up tightened the empty reason for dirty-only runs and forced
untracked files into the status check. The remaining `assume-unchanged` /
`skip-worktree` edge case is parked in
`backlog/drift-ai-stale-markers-hidden-index-flags.md`.

Validation: focused stale-marker/coldspots Vitest and `FORCE_VERIFY=1 bun run
test -- scripts/drift-ai`.

---

## 2026-05-31 — Drift:ai coldspots in-window candidate disclosure

Completed drift-ai review task 26. The coldspot section now carries a
JSON-visible `candidateModel` for `in-window-touched-files`, and text output,
empty reasons, and `--help` disclose that current files with no in-window commits
are outside the existing lens. True zero-touch current-file detection remains a
future separate evidence section.

Validation: focused coldspots Vitest and `drift:ai coldspots --lens coldspot
--window 180 --format text`.

---

## 2026-05-31 — Drift:ai duplicate value review fixes

Completed drift-ai review task 24. Multi-line duplicate string/template literal
and duplicate-constant locations now report their true end line instead of
collapsing to `startLine-startLine`; focused tests cover both extractor paths.

Task 22's numeric duplicate-value guard was already landed in commit `81559ae3`;
the stale in-progress note for that landed task was removed.

Validation: focused duplicate-literals / duplicate-constants Vitest and
`bun run lint:ratchet`.

---

## 2026-05-31 — Harness Review Notes

Added `docs/agent_notes/harness-review-2026-05/`, a six-file harness review
artifact covering current-state audit, source findings, recommendations,
rejections/deferred ideas, and generic harness principles. Follow-up review
corrected source attribution/title details, narrowed overstated repo claims, and
clarified the proposed timing-history and diagnostics-aggregation contracts.

---

## 2026-05-30 — Drift:ai documentation refresh

Refreshed the drift:ai operator and harness docs after reviewing the current
CLI/check surface. `scripts/drift-ai/README.md` now has a quick-reference table
for scopes, checks, output, chunking, subcommands, and exit behavior; the stale
"always exits 0" language was replaced with the `--fail-on-findings` contract.
`docs/ai-harness.md` now separates the default report, opt-in whole-graph
checks, and `hotspots` advisory. `harness.controls.json` now inventories
`drift:ai hotspots` plus the opt-in `orphan-files`, `import-cycles`, and
`near-duplicates` checks, and `docs/generated/harness-controls.md` was
regenerated. CLI help for `drift:ai hotspots` now lists every implemented lens.

Validation: `bun run docs:harness-controls:check`, `bun run drift:ai
harness-freshness`, `bun run drift:ai --help`, `bun run drift:ai hotspots
--help`, and focused drift-ai Vitest for the main runner, hotspots, subcommand
args, and check metadata.

---

## 2026-05-30 — Drift:ai metadata runtime boundary

Completed drift-ai review task 20. The check-metadata boundary test now walks
transitive relative value import/re-export closure for the lightweight metadata,
CLI-args, config-parsing, and config-defaults entry points while ignoring
type-only imports. Near-duplicate config constants and `NearDuplicateEngine`
moved to a pure leaf module so config parsing no longer reaches
`near-duplicates-fingerprint`/`ts-morph`. See
`finished_work/drift-ai-metadata-runtime-boundary.md`.

Validation: focused drift-ai Vitest for `check-metadata`, `near-duplicates`, and
`config-defaults`; `tsconfig.scripts` typecheck; `bun run verify:changed`.

---

## 2026-05-30 — Drift:ai root scope predicate

Completed drift-ai review task 18. `path-util.ts` now owns broad current-scope
whole-repo root semantics via `isWholeRepoRoots()`, and current inventory uses
that helper for root inclusion and ignore handling. The duplicates
large-inventory warning keeps its stricter local predicate so mixed roots such as
`[".", "packages/server/src"]` do not warn. See
`finished_work/drift-ai-root-scope-predicate.md`.

Validation: focused drift-ai Vitest for `path-util`, `current-inventory`,
`duplicates`, and `knip-orphan-files`; `drift:ai --scope current --root
scripts/drift-ai --check orphan-files --format text`.

---

## 2026-05-30 — Lint Ratchet Smoke Edit-Check Fixture Split

Lint-debt issue 08g. The edit-time check fixture family moved from
`scripts/test-lint-ratchet.sh` into
`scripts/test-lint-ratchet-edit-check-fixtures.sh`, sourced by the aggregate at
the original point in the smoke sequence. The new helper reuses the aggregate's
fixture setup and the script-smoke path policy now selects `test-lint-ratchet`
when that helper changes.

Follow-up review fix: `test-ai-hooks` changed-file selection now covers the
`scripts/ai-hooks/` directory by prefix, including
`scripts/ai-hooks/ratchet-regression-check.sh` and
`scripts/ai-hooks/edited-paths.sh`, with assertions in
`scripts/test-test-scripts.sh`. The temporary backlog note for that coverage gap
was removed because the gap is closed.

---

## 2026-05-29 — Ratchet-Regression Hook: Cap No Longer Caches A Partial Check

Lint-debt issue 01. The edit-time ratchet-regression advisory hook
(`scripts/ai-hooks/ratchet-regression-check.sh`) applied its per-edit target cap
BEFORE computing the content-cache token and the `matched == checked` cache
guard, so a file matching more ratchets than `AI_RATCHET_REGRESSION_MAX_TARGETS`
could cache the capped slice as if complete and silently skip the dropped
targets on later identical saves. Discovery now keeps a full `all_target_rows`
set distinct from the capped `exec_target_rows`; the cache token and per-file
matched count both derive from the full set, so a capped file is never cached as
complete and is re-linted on re-save. When the cap drops targets the hook now
emits a quiet, throttled partial-check advisory even when the checked subset is
clean, so a partial result is never mistaken for a clean full check without
repeating on every save. Advisory-only; the commit/verify `lint:ratchet` gate was
unaffected either way.
emits a quiet partial-check advisory even when the checked subset is clean, so a
partial result is never mistaken for a clean full check. Advisory-only; the
commit/verify `lint:ratchet` gate was unaffected either way.
## 2026-05-30 — Drift:ai default config plain factory

Completed drift-ai review task 15. `DEFAULT_DRIFT_AI_CONFIG.checks` is no longer a
memoized lazy getter — it is plain materialized data. New
`makeDefaultDriftAiConfig()` factory returns a fresh, fully plain config on every
call and replaces `cloneDefaultConfig()` (callers updated). The getter's old
registry/runtime cycle is gone: `config-defaults`'s runtime closure
(`-> check-metadata -> *-check-config -> leaf modules`) never re-enters
`config-defaults`/`config-parsing`, so eager materialization is cycle-safe. See
`finished_work/drift-ai-default-config-plain-factory.md`.

Validation: full `scripts/drift-ai` Vitest (478), `drift:ai --check near-duplicates`
JSON + `--check all` text, `typecheck`, ESLint on touched files.

---

## 2026-05-30 — Drift:ai check defaults single source

Completed drift-ai review task 06. Check defaults now flow from
`CHECK_PLUGINS[*].defaultConfig` into `DEFAULT_DRIFT_AI_CONFIG.checks` via
`buildDefaultChecksConfig()`, and omitted check parsing clones plugin defaults
directly. `config-paths.ts` is now normalization-only, avoiding the
registry -> plugin -> path-helper cycle risk. Tests cover omitted defaults, empty
per-check parse defaults, and the full `near-duplicates` default shape.

Validation: focused scripts Vitest for `drift-ai` and `near-duplicates`,
`drift:ai --check near-duplicates`, `typecheck`, `lint:ratchet`, and full
`test:scripts`.

---

## 2026-05-30 — Drift:ai shared source walking

Completed drift-ai review task 04. `scripts/drift-ai/source-walk.ts` now owns
recursive source traversal for import-cycles and near-duplicates: configured root
handling, missing-root tolerance, ignore filtering, `.d.ts` exclusion, extension
filtering, overlapping-root dedupe, caller `accept(relPath)` filtering, and
locale sorting. Import-cycles uses the absolute-path wrapper for TypeScript
resolution; near-duplicates keeps repo-relative paths and maps `excludeGlobs`
through the shared predicate.

Validation: focused Vitest for `source-walk`, `import-cycles`, and
`near-duplicates`, targeted lint, and full `test:scripts`.

---

## 2026-05-30 — Drift:ai invalid explicit tsconfig handling

Completed drift-ai review task 02. `import-cycles` now caches tsconfig load
state as `loaded | missing | invalid`, rejects missing/malformed explicit
`--tsconfig` overrides as skipped `no-target-config` outcomes, and counts only
successfully loaded configs for nearest discovery. The TypeScript read/parse
diagnostics are surfaced compactly in the skip reason. Validation: focused
`bun test` for `import-cycles` + `drift-ai`, full `test:scripts`, `typecheck`,
`lint:ratchet`, and the manual missing-tsconfig drift command.

---

## 2026-05-29 — Drift:ai task 50 cleanup complete

Closed the remaining task 50 checklist items. Added `line-scanner.ts` as the
shared string/comment scanner used by comment metrics and suppression extraction,
with template-literal and escaped-delimiter tests on both paths. Added
`repo-io.ts` for safe repo-relative path/read/list/probe factories and
`finding-lines.ts` for shared WARN/FIX rendering across the main report and
`harness-freshness`.

Also removed the duplicates runner/bin re-export round-trip (`duplicates.ts`
stays parser/scope/finding engine; `duplicates-runner.ts` owns execution;
`jscpd-bin.ts` owns binary resolution) and kept suppression parser constants in
`suppressions-parse.ts` while `suppressions.ts` owns diff orchestration.
`ghost-files` now exposes `weakTokens` and `entryPointStems` config knobs, with
the previous hardcoded values preserved as defaults and threaded through
changed/current matching plus current-scope bucket fallback. Validation:
drift-ai test suite (425 tests) and `lint:ratchet` green.

## 2026-05-29 — Drift:ai hotspots first lenses: churn + coupling (task 41)

Shipped the two required hotspot lenses on task 40's collector. New modules:
`hotspots-churn.ts`, `hotspots-coupling.ts`, `hotspots-actionability.ts`
(shared per-row context). The churn reduction moved out of `hotspots.ts`.

Durable decisions:

- **Advisory shape moved to `sections`.** Task 40's flat `hotspots: HotspotEntry[]`
  became `sections: HotspotSection[]` (discriminated by `lens`), with per-lens
  metadata on the section (churn standout factor/median; coupling
  minSupport/degreeCap/sweepCap). `--lens all` emits both sections and future
  lenses (42) just append. Brand firewall preserved (`kind: "advisory"`, no
  `findings`/WARN/FIX, reachable only via `drift:ai hotspots`).
- **Churn is thresholded, never padded.** A file shows only if score ≥ 2× the
  in-window median churn; a flat distribution yields "no clear hotspots this
  window" and zero rows. This is the closest hotspots gets to the main report's
  "a clean run is meaningful" virtue.
- **Coupling: symmetric score + two structural legibility controls.** Score
  `coOccur / min(coRevs[a], coRevs[b])` where `coRevs` counts only the 2..K-file
  commits (so `coOccur ≤ coRevs`, score ∈ (0,1]). `minSupport` (3) cuts the long
  tail; a per-node degree cap (5) bounds how many partners any one file
  contributes to the list (greedy in rank order) so a lockfile/locale clique is
  *bounded but visible*, not filtered. Wide commits (> 40 files) are skipped as
  sweeps. These are structural controls, NOT generated-file classification (01 §3).
- **Cross-boundary = first path segment differs.** Repo-agnostic and matches the
  OpenClaw depth-1 example; deliberately not a package-depth heuristic (that would
  be an unportable drift:ai opinion about a foreign repo). Cross-boundary pairs
  sort above same-directory pairs unconditionally.
- **Actionability without recommendation** (brainstorm §1.8): every row carries
  top authors/agents (commit author + `Co-authored-by` trailers, email stripped),
  3 most-recent subjects (records are newest-first from `git log`, no date parse),
  raw numbers behind the score, and a copy-paste `git log` inspect command.
  `--baseline <prev.json>` tags rows `↑NEW`/`↑+N`/`↓-N`/`=steady` — so JSON is the
  substrate and text renders from the same data. New flags: `--top`,
  `--min-support`, `--baseline`.

Hardened after a codex second-opinion pass (no P0; 1 P1 + 4 P2 applied):
churn baseline deltas are metric-aware (a prior `lines` advisory is not compared
against a current `revisions` run — deltas omitted with a disclosing note); a
`--baseline` file containing literal `null` tags rows NEW rather than reading as
"no baseline"; non-finite baseline scores are rejected (Infinity/NaN would render
as JSON `null`); coupling row context (authors/recent subjects) is filtered to the
same 2..sweepCap window the score uses, so a wide sweep can't appear as a pair's
evidence; inspect commands shell-quote paths with spaces/metacharacters.

Validated read-only on OpenClaw (30d, 15,454 commits, blobless → revisions-only):
the predicted discord↔config cross-boundary coupling surfaces near the top
(`extensions/discord/src/config-schema.test.ts ↔
src/config/zod-schema.providers-core.ts`, 17×); lockfile/CHANGELOG partners are
bounded by the degree cap, not filtered; churn top-N is the realistic noisy list
(CHANGELOG 3678, package.json, pnpm-lock, generated `.sha256`). Musi: coupling
surfaces `.claude/… ↔ .codex/…`; baseline round-trip tags all `=steady`. 396
drift-ai tests green; lint:ratchet clean.

## 2026-05-29 — Drift:ai hotspots collector + subcommand scaffold (task 40)

Landed the foundation of the hotspots track: a shared windowed git-history
collector (`hotspots-history.ts`) and the brand-firewalled `hotspots` subcommand
(`hotspots.ts` runner + `hotspots-format.ts` advisory/render), with a trivial
churn placeholder reduction (real lenses are tasks 41/42). Also introduced a
shared subcommand arg parser (`subcommand-args.ts`: universal
`--format`/`--output`/`--config` + per-subcommand value options) and retrofitted
`harness-freshness` onto it, closing the M4/L1 wart from task 50.

Durable decisions:

- **Collector is git-only and reduce-once.** One windowed `git log` walk parsed
  into typed per-commit records; every future lens reduces over the same walk.
  `--no-merges` + `--no-renames` (the latter is load-bearing for parser
  correctness — arrow-form paths would corrupt the tab-split). Format uses
  `%x00`-prefixed metadata lines (NUL can't occur in a path → unambiguous commit
  boundary), `%x1f` field sep, `%x1d` co-author sep. The `%x..` escapes are passed
  as literal text to git (a raw NUL in argv would truncate the arg); the parser
  works on the expanded bytes.
- **Blobless partial clones → `--name-only` fallback.** `--numstat` needs blob
  content and hangs fetching blobs on a `blob:none` clone (OpenClaw). The
  collector probes `remote.*.partialclonefilter` / `extensions.partialclone` and
  falls back to `--name-only`: revisions stay exact, line counts are disclosed as
  unavailable. This is a delta from the task spec, which had only flagged
  shallow-clone `git diff` (not hotspots numstat).
- **Honest adaptive header.** Sparse history widens the window (14d → up to 180d)
  and reports the effective window; squash-y history (high single-revision ratio)
  auto-switches the churn metric to `lines` and discloses it — but never switches
  when line counts are unavailable. Conservative thresholds so near-linear repos
  (OpenClaw) do not misfire.
- **Brand firewall** (three layers): JSON is `{ kind: "advisory", hotspots: [...] }`
  (never `findings`/WARN/FIX/DriftFinding); reachable only via `drift:ai hotspots`
  (no `DriftCheckId` entry); mandatory header + "areas to check, not defects"
  banner. churn × complexity is deliberately NOT a lens (complexity is a
  lint-baseline concern, task 30).

Validated read-only on OpenClaw (4,134 non-merge commits/14d, `--name-only`
fallback, squash guard does not fire) and on Musi (numstat, full clone). 362
drift-ai tests green.

## 2026-05-29 — Drift:ai near-duplicate functions adapter (task 33)

Added the opt-in `near-duplicates` check, a measurement-ish adapter over
drift:ai-authored function-similarity thresholds. The default engine fingerprints
named functions/methods/assigned arrows with ts-morph/TypeScript, normalizes
binding identifiers and type annotations, retains property names, and compares
functions in conservative normalized-statement buckets. Findings carry
`[drift-baseline]` provenance and are sorted by `lines * similarity`; changed
scope reports only pairs touching a changed file.

`similarity-ts` is supported as an optional config-selected engine name; because it
is a Cargo binary rather than a tools-checkout npm dependency, absence is a clean
`tool-not-installed` skip, not a finding. The check is excluded from
`DEFAULT_CHECKS` and activates via `--check near-duplicates` / `--check all`.

Validation: Musi `scripts/drift-ai` current scope found the existing jscpd/knip
resolver helper clones in ~0.13s. OpenClaw current scope over
`src/packages/apps/extensions/ui/config` completed in ~9s over 14,923 scoped files
with 619 `near-duplicates` findings, no skips. An initial all-pairs comparison was
aborted after >60s; the landed statement-bucket pass keeps the check usable on
large foreign repos.

## 2026-05-29 — Drift:ai knip orphan-files adapter (task 32)

Landed the **first external-tool adapter** — `orphan-files`, a Tier-1
pass-through over the target's own knip (unused-files category only). As the
foundational adapter it introduced the shared adapter infrastructure tasks 31/33
build on, all against the task-30 contract:

- **Provenance + schema bump.** New optional `DriftFinding.provenance`
  (`{ configSource, tool, configPath? }`) and `SkippedDriftCheck.code`
  (`SkipReasonCode`); `DRIFT_SCHEMA_VERSION` 2 → 3 (both additive). Text output
  tags findings `[target-config]` so a verdict's authorship is never disguised.
- **Shared helpers** (`adapter-support.ts`): `PathProbe` + `defaultPathProbe`,
  `detectTargetInstall`, `discoverToolConfig` (ladder rungs 1–2). New injected
  `CheckRunDeps.pathExists` (reused by 31/33) and `CheckRunDeps.knip` runner
  (`knip-runner.ts`, bin resolved from the tools checkout first, mirroring jscpd).
  `--knip-config <path>` override (ladder rung 1).
- **Skip vs finding (jscpd-precedent correction).** Expected absence → `skipped`
  with a machine `code`: `no-target-config` / `target-not-installed` /
  `tool-not-installed`. Only an attempted-and-failed run (cannot spawn, or
  unparseable stdout) emits **one** diagnostic finding — never one-per-root. knip
  exit 1 = issues found, not failure.
- **Opt-in by default.** New `runByDefault` plugin flag + `DEFAULT_CHECKS` (vs
  `ALL_CHECKS`): knip analyzes the whole graph on every run, so orphan-files stays
  off the routine changed-scope run and activates via `--check orphan-files` /
  `--check all`. No knip latency or skip-noise on the common path.
- **Validated:** Musi (root `knip.config.ts`, installed) → 3 orphans, byte-for-byte
  matching raw `knip --include files`, stamped `[target-config]`. OpenClaw
  (non-root `config/knip.config.ts`, **no** `node_modules`) → config located, then
  a clean `target-not-installed` skip (the headline foreign-repo case), exit 0.

## 2026-05-29 — Drift:ai Adapter Policy & Base Contract (task 30)

Landed the policy + base contract that governs every external-tool adapter in
drift:ai, as `docs/agent_notes/backlog/drift-ai-tasks/03-adapter-contract.md`
(doc/contract only — no runnable code; validated when tasks 31/32 implement
against it). Governing rule: **own the provenance of the verdict** — every adapter
finding is stamped `target-config` / `tool-default` / `drift-baseline`, and
drift:ai may run our own `ai_devx_stuff-lint` baseline against a foreign repo
(Tier-2, explicit `--baseline-profile=ai_devx_stuff-lint`) as long as it says so.

The contract is grounded in the real task-21 types: an adapter is a `CheckPlugin`
whose `run` delegates to tool orchestration (`preflight` → `resolveConfig` skip),
returning the existing `CheckOutcome` (`ran | skipped`) — so the jscpd-precedent
correction (expected absence = `skipped` with a machine `code`; tool-ran-and-failed
= one `ran` diagnostic, never one-WARN-per-root) needs no schema change. Reconciled
the source prose's hypothetical `status: "error"` with the landed two-state union.
Also documented the four-rung config-authority ladder (config-honoring adapters
only), the measurement-ish carve-out, the candidate catalog, and the shared
install-detection / config-discovery helpers tasks 31/32 consume. Split the flat
"Explicitly do NOT add" lists in `drift-ai-improvements.md` (Part D) and
`drift-ai-review/additional-checks-research.md` into Category 1 (don't hand-roll) /
Category 2 (may orchestrate via adapter) / Still-excluded. Tasks 31/32/33 now cite
the contract from their Background sections.

## 2026-05-29 — Drift:ai Reporting Trust Pass (task 22)

Made drift:ai JSON findings-first and scope-light by default. Reports now carry a
`summary` (`total` plus per-ran-check counts) and `scopeCount`; `formatJson`
omits the full `scope` array unless `--include-scope` is passed. Text output now
prints the same findings summary line and renders skip reasons directly.

Chunk output is now strictly per-check, so chunk labels and `NNN-<check>.json`
filenames cannot describe mixed-check contents. The suppressions current-scope
dead-end now reports that suppressions is only available in changed scope, and
same-file duplicate clones use local-repeat wording with a local extraction hint.

OpenClaw current-scope JSON dropped from 1,673,333 bytes to 217,984 bytes by
default; `--include-scope` restored the full scoped payload at 1,673,613 bytes.
The default JSON top now reaches `summary` and `findings` before any scope data.

## 2026-05-29 — Drift:ai Check Plugin Registry (task 21)

Replaced bespoke drift:ai check dispatch with a `CHECK_PLUGINS` registry and
`CheckOutcome` union. The runner now builds one `CheckRunContext` with grouped
I/O deps; duplicates, ghost-files, comments, and suppressions each have a plugin
module owning config parsing, preflight, and run behavior.

`DriftReport.skippedChecks` is now structured `{ check, reason }[]`, with
suppressions skipped in current scope and missing jscpd skipped through the same
channel. Schema version moved to `DRIFT_SCHEMA_VERSION = 2` and is shared by
reports, chunks, and manifests. Runtime `ALL_CHECKS` and CLI usage derive from
the registry; `DriftCheckId` stays leaf-local in `types.ts` to avoid a runtime
cycle through the plugin modules.

OpenClaw current-scope smoke exited 0 with schema 2, 14,923 scoped files, 360
findings (20 duplicates, 329 ghost-files, 11 comments), and suppressions skipped
with reason `not run for current scope`.

---

## 2026-05-29 — Drift:ai Shared Path Utilities (task 20)

Extracted `scripts/drift-ai/path-util.ts` as the canonical home for POSIX path
normalization, source-extension checks, sorted unique strings, changed-scope
file extraction, finding sorting, and configured-root matching. `normalizeRepoPath`
now delegates to the shared `toPosix`, closing the previous comments /
ghost-files normalization divergence around `./`, trailing slashes, and
backslashes.

Updated duplicates, ghost-files, comments, current-inventory, config parsing,
and suppressions callers to import the shared helpers. Suppressions keeps its
map-shaped status filtering local because it deliberately drops deleted files.

---

## 2026-05-29 — Drift:ai Shallow-Clone Degradation (task 14)

Changed scope now degrades cleanly when git history or objects are unavailable.
`discoverChangedFiles` proactively checks `git rev-parse --is-shallow-repository`
and reactively converts SIGSEGV/missing-object diff failures into a clear
`DriftAiError` that suggests `git fetch --unshallow` or `--scope current`.
Unrelated diff errors still propagate, and current scope does not run the new
probe.

No target-`node_modules` hook was added: with task 12 landed, `duplicates`
resolves `jscpd` from the tools checkout and the other default checks do not
need target-local installs. Adapter skip policy remains for tasks 31/32.

## 2026-05-29 — Drift:ai Portable Output Cleanup (task 13)

Ghost-files hints are now repo-agnostic by default and configurable per target.
`checks["ghost-files"].dependentsHint` is a validated `{path}` template; the
built-in hint is `Check what imports {path}`, while Musi's committed config opts
back into `bun run code:intel -- dependents {path}`. Current-scope pair hints
apply the same template once per peer path and separate the rendered hints with a
semicolon.

Added `drift-ai.config.example.json` as a generic TypeScript starter config and
linked it from `scripts/drift-ai/README.md`. The portable README and
`harness-freshness.ts` now document `harness-freshness` as a Musi-specific
subcommand outside the portable default check surface. Validated with the full
drift-ai test set plus OpenClaw and Musi current-scope smoke checks.

## 2026-05-29 — Drift:ai Target `cd` Flow (task 11)

Expanded `scripts/drift-ai/README.md` to make the supported target-selection
flow explicit: `cd <target-repo>` first, then invoke the tools-checkout script by
absolute path. Deferred `--repo <path>` remains intentional and now records the
six path semantics that must be designed together before it can land: Git cwd,
config discovery root, `--output` base, `--chunk-dir` base, `--root` validation,
and subprocess cwd. No wrapper was added. Verified the documented OpenClaw
current-scope command exits 0 with repo-relative finding paths; the remaining
duplicate warnings are the known task-12 jscpd-resolution gap.

---

## 2026-05-29 — Drift:ai Tools-Checkout Contract (task 10)

Documented the portable "tools checkout vs. target repo" contract at
`scripts/drift-ai/README.md` (doc-only; first Portability MVP task). It travels
with the tool: Bun is the tool runtime, the tools checkout owns implementation
deps (`bun install` once), the target supplies only source and never installs
drift:ai deps, config is discovered from the target cwd, and the `cd <target>`
flow is the supported MVP (no `--repo` flag). A "Known gaps (tracked)" section
cross-links the behaviors still being aligned: jscpd bin resolution (task 12),
shallow-clone degradation (task 14), Musi-ism output cleanup (task 13). Verified
the documented invocation runs to exit 0 with repo-relative paths against
OpenClaw. Unblocks tasks 11 and 12.

---

## 2026-05-29 — Drift:ai Hotspots Shape Lock

Hotspots now locks churn and co-change coupling as required lenses rather than a
fork; implementation order is flexible. The former churn × complexity v5 lens is
closed as won't-do because complexity is covered directly by the
`ai_devx_stuff-lint` baseline adapter from task 30.

---

## 2026-05-29 — Drift:ai Adapter Baseline Direction

Adapter policy now treats imposed baselines as a first-class product direction
for foreign repos: drift:ai may run shared lint rules against a target and report
the violations, with findings clearly stamped as `drift-baseline` rather than
target-owned standards. The adapter ceiling now includes lint-rule orchestration,
not only structural cross-file checks; task 30 still keeps implementation of a
concrete lint-baseline adapter out of scope.

The public profile UX is `--baseline-profile=ai_devx_stuff-lint`. The first
profile should be curated and portable, focused on generic AI-drift signals such
as complexity, file length, and too many arguments, not repo-specific rules from
this codebase.

---

## 2026-05-29 — Drift:ai Backlog Decision Lock

Locked several drift:ai backlog choices so future agents do not re-escalate
them: portable docs live at `scripts/drift-ai/README.md`; task 13 commits
`drift-ai.config.example.json` and uses `checks["ghost-files"].dependentsHint`
with a `{path}` placeholder; the external-repo flow is docs-only
`cd <target>; bun <tools>/scripts/drift-ai.ts` with no wrapper; reporting uses
per-check chunks, `{ total, byCheck }` summaries with zero-count ran checks, and
JSON-only `--include-scope`; import cycles spike `ts-morph` first with
`import-x` fallback and no new `madge` dependency by default. Task 51 standalone
Node/npm extraction is closed as won't-do.

---

## 2026-05-29 — Lint Ratchet Debt Log Hardening

Debt-log acceptances now use a retry-idempotent append before baseline writes:
if a previous attempt appended the exact JSONL line but failed to write the
baseline, the retry recognizes the debt-log tail and does not duplicate it.
The audit schema rejects no-op acceptances, reuses the baseline item/path parser
for orphan snapshots, validates orphan metric fields against their metric, and
shares orphan detection between registry preflight and update logging.

---

## 2026-05-28 — Lint guidance fixes (R1–R7)

Seven commits on `feat/lint-improvements-v2` (`da304a37`..`eb40127c`) making the
lint-ratchet / per-edit-hook guidance steer toward the *working* recovery
action without turning any advisory surface into a gate. Highlights: a shared
`scripts/lint-ratchet/recovery-command.ts` so regression `howToFix` + report
footer + CI emit the `-- --allow-worse --reason` form the updater actually
accepts; verify/pre-commit now render `lint:ratchet:report` on failure (per-step
`HARNESS_DIAGNOSTICS_OUTPUT` + `ai_ratchet_failure_excerpt`) instead of a raw
JSON tail; the tidy hook surfaces residual eslint *warnings* after `--fix`; the
stop reminder names the failing gate from per-step meta; generic ratchet findings
carry their registry rationale. Advisory model preserved (hooks stay exit 0).
Codex review: no P0/P1/P2. Detail: `finished_work/lint-guidance-fixes.md`.

## 2026-05-28 — ESLint 10 Upgrade (Phase A)

Bumped `eslint` 9.39.4 → 10.4.0 and `@eslint/js` → 10.0.1 (exact pins). Two
required code changes:

- **`nodeType` removed from the lint-ratchet complexity-severity metric**
  (`scripts/lint-ratchet-metrics.ts` + tests). ESLint 10 dropped
  `LintMessage#nodeType` (PR #20096), so per-function identity now keys on
  `line` + parsed `label`. All 5 complexity ratchets are zero-baselines, so this
  was a clean removal, not a baseline-format migration; the parser silently
  ignores any stray legacy `nodeType` field.
- **React-plugin peer exception (`eslint-plugin-react` 7.37.5 /
  `eslint-plugin-jsx-a11y` 6.10.2 cap at eslint ^9).** Bun warns but installs;
  ESLint does not enforce plugin peers at runtime. No `overrides` entry (Bun
  overrides can't widen a peer range). Enforced by network-free watchdog
  `scripts/check-eslint-react-peer-exception.sh` (uses `Bun.semver.satisfies`,
  rejects malformed/unbounded ranges, fails only once both plugins admit ESLint
  10) wired into `audit:deps`. Removal tracked in
  `backlog/eslint-react-peer-exception-removal.md`.

Runtime fix: `eslint-plugin-react` 7.37.5's `settings.react.version: "detect"`
path calls the removed `context.getFilename()` and crashes every react rule
under v10, so the client config now pins `react.version` to `"19.2"`
(`eslint-config/client-configs.js`). jsx-a11y has no removed-API usage. v10's
new `eslint:recommended` rules and JSX reference tracking produced zero new
findings. jsdoc 63 stays deferred as Phase B
(`backlog/eslint-plugin-jsdoc-63-upgrade.md`).

## 2026-05-27 — Lint Adopter Docs and System Improvements

Landed lint adopter docs follow-up, tidy hook changed-file notice, ESLint
entrypoint exports cleanup, linted script reinclude patterns, lint-agent alias
retirement, warning severity semantics docs, agent hook pinned tools, CI
coverage-map gate, parallel runner ownership docs, ratchet CI pass dedup, CI
lint step dedup, and Biome fast edit-loop spike/adoption guide. Also landed
ESLint shared policy extraction and fixture Git environment hardening.

The lint system improvements backlog (`backlog/lint-system-improvements/`) was
the main work area for this period. Remaining parked items are in that folder.

## 2026-05-25 — Autonomous Iteration Batch

Landed several ratchet drains and tooling improvements on
`feat/autonomous-batch-iteration`:
- Shared post-edit tidy hook (`scripts/ai-hooks/tidy-edited-file.sh`) with
  Claude and Codex adapters
- Expand-barrel, concurrency-guard, and codemod complexity drains (total
  `lint:ratchet` findings went from 18 → 0)
- Runtime max-lines split for `scripts/lint-ratchet.ts` and baseline modules
- Drift-ai max-lines drain (split into focused modules)
- Doctor JSON smoke perf optimization (58s → 1.3s)
- Lint-ratchet smoke perf (95s → 24s)
- Changed-smoke selection improvements

## 2026-05-24 — Drain Remaining Ratchets Review

Split logs-audit request-id helpers, expanded ratchet coverage, refreshed
baseline metadata, added test regression for top-level helper edits.

## 2026-05-23 — Pre-commit Budget Work

Changed-mode verify now runs the local gate in parallel. Verify/pre-commit
defaults returned to hard=240s / warn=210s. Heavy ratchet smoke narrowed
(4m46s → 1m54s). Measured `verify:changed` at 199s and pre-commit at 204s.

Also landed lint-ratchet sharing backlog (33 commits, Leaves 01-07): strict
improvement enforcement, portable adoption guide, CI workflow parity, baseline
summary command, PR comment report formatter, check-registry preflight.

## 2026-05-21 — Ratchet Complexity Drains and Coverage

Drained complexity from `lint-ratchet-baseline.ts`, `lint-ratchet.ts`, and
`lint-ratchet-metrics.ts`. Landed coverage-map staged-content gate, ShellCheck
and yamllint system binary switches, hadolint wrapper cache fix, actionlint
per-file argv fix, workflow/config lint sensors, and root/package TS config
file linting.

Also added `ratchet/core-complexity-lint-ratchet-runtime` and converted
top-level scripts ratchet to `complexity-severity` metric.

## 2026-05-20 — Leaf 41 Coverage Map and Ratchet-First Planning

Landed the coverage map artifact at
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`. Ratchet-first
planning clarified: ratchets are migration floors not indefinite parking, add
in small measured batches, re-measure runtime after each batch, bug-class
findings are fix-soon drains. Core ESLint rule-source support added to the
ratchet runner. First batch: `ratchet/local-max-lines-codemods`.

## 2026-05-29 — drift:ai Hotspots Lenses Complete

Closed backlog task 42 by adding the remaining git-only hotspot sections:
author/agent fragmentation, suppression-churn, and thrash. `--lens all` now
renders churn, coupling, fragmentation, suppression-churn, and thrash in the
advisory `sections` shape. OpenClaw validation exposed that `git log -G` needs
blob content, so suppression-churn skips with a clear reason on blobless partial
clones; thrash already reports line-count unavailability there.

## 2026-05-31 — Drift:ai knip include selection

Closed review task 28: knip-backed drift:ai checks now choose `--include`
categories from the resolved check set. Single-check runs stay narrow, both/all
runs keep the shared full report, and the memo key includes include categories.

## 2026-05-19 — Type Assertion Boundary Drain and Lint Leaf Inventories

Landed type-assertion-boundary batches 3b through 6 (ratchet 114 → 41).
Inventoried and deferred several lint rules after evaluation: clock primitives,
process.env, raw fetch, jsx-no-leaked-render, set-state-in-effect,
no-param-reassign props, no-await-in-loop. Fixed 5 bugs found by
vitest/no-conditional-expect triage. Organized remaining follow-up work into
`backlog/lint-followups/`.

## 2026-05-17 — Lint Hardening Review Follow-ups Complete

All three follow-up tiers landed:
- Tier 1: dead procedures, tautological smoke, commitlint bug, redundant
  safeParse blocks
- PR 2: harness manifest + generated controls map (55 controls, 9 kinds)
- PR 3a: harness-diagnostics Zod envelope, `lint:agent` with local-rule
  re-projection
- PR 3b: `--json` modes on doctor, verify:logs, module:index:check,
  migration-safety-scan

## 2026-05-16 — Lint Hardening Sprint

Landed Leaves 1-14 of the lint-hardening backlog in rapid succession:
zero-warning gate, changed-gate staged content verification, Vitest ESLint
plugin, ESLint comments hygiene, jsx-a11y, TanStack Query plugin, Knip sensor
(report-only), scripts/drift ESLint coverage, TypeScript ESLint stricter
opt-ins, core AI-footgun rules, restricted primitives (process.env, raw fetch),
type-assertion-boundary rule, eslint-plugin-react subset, react-hooks broadened,
and JSON lint.

## 2026-05-15 — Harness and Rules Work

- `code:intel -- overview` for tRPC router procedure summaries
- Drift AI suppression diff fixes
- AI harness external tooling research (Svelte/Effect patterns)
- AGENTS.md startup guidance trimmed (lint/hooks now carry enforcement)
- SRD rules divergence fixed (weapon properties, prepared spell tables)

## 2026-05-11 — Local Lint Rule Sprint

Added `local/no-swallowed-errors`, `local/no-async-array-callbacks`,
`local/no-llm-artifacts`. Enabled core ESLint companions
(`no-useless-assignment`, `preserve-caught-error`, etc.) and global
`require-atomic-updates`. ESLint disable policy gate tightened.

## 2026-05-10 — Drift AI and BatonLoop

- `drift:ai --scope current` finished (comments, chunk output, harness docs)
- BatonLoop queue fully landed: 5e rules logic guide, migration safety output,
  module index guide coverage, homebrew class/subclass caster fields, SRD ritual
  adept rename, reviewed scenario fixtures
- Worktree-local observability started (logs:audit quality checks)
- AI drift sensors Leaves 2-5 landed

## 2026-05-07 — Architecture Lint and Repair Text

Added `local/concurrency-guard`, `local/trpc-require-output-schema`,
`local/no-broadcast-in-transaction`. Added `local/no-explicit-any` and
`local/max-lines` with agent-facing repair guidance. Client feature
cache/socket guide added.

## 2026-05-06 — Codemods, Guides, and Structured Logging

- Concurrency guard checker (`codemod:concurrency-guard -- --check`)
- Race-sensitive mutation guide, Prisma migration guide
- Structured logging codemod and `local/structured-logging` enforcement
- tRPC shared schema codemod review closed

## 2026-04-28 — DX Sprint Completion

Closed DX5-DX8 sprint: socket broadcast registry (DX5.3), client component
splits (DX6), fixture builder inventory (DX7.0c), spell-casting test split
(DX7.1g), Prisma migration safety scanner and doctor integration (DX8.1),
mutation boundary logs (DX8.2d), and five merge-review follow-ups (FU1-FU5).

## 2026-04-27 — DX1-DX4 Sprint Closed

First developer-experience sprint landed through DX4.4. Active queue moved to
DX5-DX8 roadmap.
