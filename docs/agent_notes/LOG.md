# Log

Curated recent history. Do not use this file as an archive for every landed
task; keep only entries that help orient future sessions.

Newest on top.

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
