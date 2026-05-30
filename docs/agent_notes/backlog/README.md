# Backlog

Parked workstreams that still matter, but should stay out of the default
agent loop.

Do **not** read this folder at session start. Promote an item back into
`in_progress/` only when the active loop empties or a human reprioritizes it.

## Parked items

- `production-readiness.md` — error monitoring, CI/CD hardening, Docker
  deployment, infra hardening, and data-integrity audit. Largest unstarted
  scope; depends on the app shipping to real users.
- `polish-and-mobile.md` — mobile optimization, file uploads/avatars, JSON +
  PDF export, accessibility verification, UX refinements. Predecessor:
  `production-readiness.md`.
- `ux_ui_audit/` — 2026-04-14 end-to-end audit (DM + player Playwright passes,
  UX/UI/backend code reviews, prioritized 28-item ROADMAP). Last revalidated
  2026-04-27: ~20 items still unstarted, ~4 partial, ~11 shipped. Re-revalidate
  before promoting any item — paths drift quickly.
- `vtt-drawer-followups.md` — deferred drawer follow-ups that need schema work:
  combat-spell resolution through `useConfirmCast` and monster structured
  `Atk` / `Dmg` wiring.
- `phase-7c-2-character-level-homebrew.md` — parked character-level homebrew spec:
  polymorphic Character-scoped FKs, unlink/grandfather policy, unified
  SRD+homebrew loader, wizard/sheet/level-up surfaces, optional compendium
  pages. Includes the proven polymorphic patterns to reuse.
- `followup-srd-castertype-issues.md` — deferred character-level homebrew prerequisites:
  ritual-casting semantics, EK/AT provenance cleanup, and homebrew caster-form
  inputs.
- `ai-harness-followups.md` — remaining conditional harness work after the
  broad harness plan landed: 5e rules guide, migration-safety output, JSON
  diagnostics, behavior fixtures, slow drift reports, and scoped review.
- `ai-harness-external-tooling-ideas.md` — research note from Svelte AI tools
  and the Effect language service: docs discovery, read-only autofix loops,
  LLM-oriented overviews, quick-fix previews, doctor fix plans, task prompts,
  protocol tests, rule metadata, and adapter-synced agent assets.
- `ai-harness-prioritized-backlog.md` — ordered promotion list merging the
  transcript review, scheduled harness-review ideas, and external-tooling
  research into one AI-harness backlog queue.
- `drift-ai-improvements.md` — 2026-05-28 four-perspective review of the
  `drift:ai` sensor (reporting UX, code quality, standalone extraction, new-check
  research), updated 2026-05-29 for the Bun-powered tools-checkout portability
  target. Central thesis: ship a small external-repo workflow first, then use a
  `CheckPlugin` registry for maintainability, new checks (import-cycles,
  near-duplicate), and single-report adapters. Includes a prioritized roadmap;
  detail in `drift-ai-review/`.
- `autonomous-agent-iteration-candidates.md` — 2026-05-25 gathered queue of
  ready autonomous AI-harness and lint-drain leaves, including the proposed
  post-edit tidy hook and stale/blocked notes to avoid.
- `dependency-age-gated-followups.md` — rerun the package age-gate queue after
  fresh same-major tags clear the seven-day policy; keep separate from major
  migrations.
- `fast-uri-override-removal.md` — drop the transitive `fast-uri` 3.1.2
  `overrides` pin once upstream chains stop pinning the vulnerable 3.1.0.
  Enforced by `scripts/check-fast-uri-override.sh` (wired into `audit:deps` and
  CI), so promotion is triggered by a failing watchdog, not a calendar.
- `eslint-react-peer-exception-removal.md` — drop the ESLint 10 peer exception
  for `eslint-plugin-react` / `eslint-plugin-jsx-a11y` once both ship an ESLint
  `^10` peer. Enforced by `scripts/check-eslint-react-peer-exception.sh` (wired
  into `audit:deps` and CI), so promotion is triggered by a failing watchdog.
- `typescript-6-upgrade.md` — isolated TypeScript 6 compiler migration plan
  covering project references, script TypeScript API consumers, and package
  flow verification.
- `fastify-multipart-10-upgrade.md` — focused `@fastify/multipart` 10 server
  runtime migration for map-image uploads and multipart parser behavior.
- `eslint-plugin-jsdoc-63-upgrade.md` — scoped major upgrade plan for the
  JSDoc plugin used by local rule authoring lint.
- `node-types-25-upgrade.md` — type-only `@types/node` 25 migration plan for
  scripts, configs, e2e, and Node-compatible Bun code.
- `cache-budget-followups.md` — conditional verification-budget work: typecheck
  optimization only if measurements justify it, per-test slow helpers, async
  e2e design, and future Stop-reporter guardrails.
- `concurrency-guard-followups.md` — optional hardening after the
  concurrency-guard codemod and ESLint rule landed: shared contract extraction,
  helper-internal lint, advisory lock-order output, and stronger provenance
  checks.
- `code-intel-followups.md` — conditional `code:intel` work after the v1 CLI
  and review slices landed: `refs`, JSON output, caching/daemon promotion, and
  targeted debug polish.
- `code-intel-daemon-options.md` — parked comparison of TypeScript
  language-service, `tsserver`, LSP, MCP, and file-index adapters if
  `code:intel` latency justifies a daemon or cache.
- `mutation-testing-stryker.md` — parked plan for adding StrykerJS mutation
  testing as a manual test-quality audit lane before any score gate.
- `lint-hardening/` — parked lint-hardening leaf notes from a Rust/Clippy vs
  Musi ESLint comparison. Promote one unresolved leaf at a time; fully landed
  leaves have been removed. Context and rollout rationale is in
  `lint-hardening/00-context-and-rollout.md`.
- `lint-reference-readiness/00-index.md` — split task index for the
  lint-system work needed before treating Musi's lint setup as reference
  material for other projects. Promote one task file at a time. Done tasks
  have been removed. The canonical adopter guide is
  `docs/guides/lint-ratchet.md`.
- `lint-system-improvements/00-index.md` — split task index migrated from the
  2026-05-26 lint-system review synthesis preserved by commit `a0975f3a`. This
  is a later lint-platform refinement queue covering CI/local parity, duplicate
  gate wiring, generated policy ownership, hook/tool portability, severity
  docs, and measured architecture spikes. Check overlap with
  `lint-reference-readiness/` before promoting.
- `lint-followups/00-index.md` — parked lint follow-up leaves after the
  lint-hardening rollout. Resolved leaves have been removed.
- `lint-ratchet-cached-baseline-context.md` — deferred no-ESLint edit-time
  advisory ("this file carries N accepted ratchet floors as of baseline"), split
  out of the per-file ratchet plan (`in_progress/per-file-ratchet-edit-feedback.md`)
  so that plan ships only the fresh regression detector. Promote once the
  detector lands and a high-debt rule is added.
- `drift-ai-current-findings.md` — 2026-05-10 triage of the first
  `drift:ai --scope current` report: current ghost-file tuning plus duplicate
  refactor candidates for token mutations, cursor lists, test contexts, token
  forms, selectable cards, sheet rows, codemods, and homebrew fields.
- `drift-ai-hotspots-subcommand.md` — 2026-05-28 design note re-opening the
  rejected "churn × complexity hotspots" idea as a **separate advisory
  subcommand** (sibling to `harness-freshness`, not a drift `check`). Captures
  the subcommand reframe and why it dissolves the original objections, a
  three-lens roadmap (churn×complexity v1; merge-conflict frequency; thrash /
  whack-a-mole), locked churn-window decisions (14d default, time-window with
  commit-count option, revisions default + lines alternate, sparse-history
  widen-with-note), the deferred eslint-vs-ts-morph complexity-source choice, an
  explicit "open knobs" list for the next session, and a clarification that the
  "do NOT add lint/knip-gated checks" rule is target-conditional (reimplement =
  no; orchestrate via adapter = yes, with care). User intends to revisit before
  building v1.
- `drift-ai-hotspots-brainstorm.md` — 2026-05-29 five-perspective blue-sky
  brainstorm (+ skeptic seat) stress-testing `drift-ai-hotspots-subcommand.md`
  and the adapter thread, empirically grounded against two repos: this one (solo
  → non-probative for the value thesis) and OpenClaw (a multi-dev AI-augmented
  TS/pnpm monorepo, where the git-only signals come back rich — 48-author files,
  real cross-package co-change). Headline shifts: churn×complexity is the wrong
  v1 (lowest team-altitude signal, only portability-hostile dependency); the real
  v1 is the shared git-history **collector**; adds **temporal co-change
  coupling** and **author/agent fragmentation** as the missing flagship signals
  and a revised lens roadmap; resolves the open knobs (ts-morph default,
  percentile normalization, dynamic-range sparse guard); reframes the adapter
  boundary as **verdict ownership** ("delegate the verdict, not just the engine")
  with a two-tier config-authority policy and the ESLint-subset inversion;
  establishes that the tool does **not** auto-detect generated/ignorable files
  (the reader supplies that context). Ends with six open forks and a
  kill-criterion experiment. No source changed.
- `drift-ai-tasks/00-index.md` — **the actionable decomposition** of the drift:ai
  improvement program into 17 self-contained task files (Tracks P portability /
  A architecture / C checks+adapters / H hotspots / X cleanup), plus
  `01-shared-context.md` and a verified `02-seam-map.md`. Each task file is
  workable from the two shared files alone. Validated against the OpenClaw target
  repo (revised assumptions noted inline). Start here to implement; promote one
  task file at a time and mark its row Done in `00-index.md`. Supersedes the
  `drift-ai-*` planning notes above for execution; those remain as deeper rationale.

## Promotion rules

1. Promote only work that is ready now.
2. Move the note or folder back into `in_progress/`.
3. Add one line to `LOG.md` if context is needed.
