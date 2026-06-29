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
- `harness-review-tasks/00-index.md` — actionable task pack from the 2026-05
  harness review and selected backlog overlaps. Promote one leaf at a time from
  this folder for the reviewed diagnostics, loop, docs/feedforward, architecture
  sensor, and governance work; older AI-harness notes remain rationale.
- `harness-presentation-2026-06/00-README.md` — 2026-06-13 research pack +
  deliverables for a 23-slide talk on harness/context/agentic engineering
  (Musi as case study): research report, slide-deck text, an 8-item improvement
  list, and the adversarial-review record. Built by a multi-agent workflow with
  every load-bearing repo number re-verified live. Improvement items 4–6 (M2
  context-budget reporter, scoped Stryker in the weekly lane, R11 SessionStart
  rehydration) are the promote-able follow-ups; items 1–3 are talk-prep.
- `autonomous-agent-iteration-candidates.md` — 2026-05-25 gathered queue of
  ready autonomous AI-harness and lint-drain leaves, including the proposed
  post-edit tidy hook and stale/blocked notes to avoid. _(Done 2026-06-21:
  5/6 landed; only the open-ended #2 verify/commit-latency measurement campaign
  remains, which is not a discrete leaf.)_
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
- `slow-test-tier-candidates.md` — Tier 3 of the 2026-06 test-runtime work:
  valuable-but-slow server concurrency tests + heavy `scripts` meta-tests to
  move into the slow tier (and the `test-lint-ratchet.sh` smoke, which needs
  new slow-smoke plumbing). Behavior change, so deferred; promote only if more
  per-commit time still needs trimming. Includes a coverage-threshold caveat.
- `concurrency-guard-followups.md` — optional hardening after the
  concurrency-guard codemod and ESLint rule landed: shared contract extraction,
  helper-internal lint, advisory lock-order output, and stronger provenance
  checks.
- `code-intel-followups.md` — conditional `code:intel` work after the v1 CLI
  and review slices landed: `refs`, JSON output, caching/daemon promotion, and
  targeted debug polish.
- `code-intel-daemon-options.md` — parked comparison of TypeScript
  language-service, `tsserver`, LSP, MCP, and file-index adapters if
  `code:intel` latency justifies a daemon or cache. _(Superseded 2026-06-21:
  the repo-owned TS-language-service daemon shipped — `scripts/code-intel/daemon-*.ts`.
  Retained only as the design-rationale record cited from `finished_work/`.)_
- `mutation-testing-stryker.md` — parked plan for adding StrykerJS mutation
  testing as a manual test-quality audit lane before any score gate.
  _(Implemented; retained as the baseline record other docs cite — `stryker.config*.mjs`.)_
- `drift-ai-current-findings.md` — 2026-05-10 triage of the first
  `drift:ai --scope current` report: current ghost-file tuning plus duplicate
  refactor candidates for token mutations, cursor lists, test contexts, token
  forms, selectable cards, sheet rows, codemods, and homebrew fields.
  _(Done 2026-06-21 except #8 — codemod-engine `parseArgs` dedup across
  `scripts/codemods/trpc-shared-input.ts`/`-output.ts`.)_
- `drift-ai-ghost-files-agent-noun-pairs.md` — parked detector-tuning follow-up
  from the 2026-06-05 field-run calibration: reviewed current-scope
  `ghost-files` false positive for intentional `evaluation`/`evaluator` role
  siblings.
- `semgrep-drift-sensor-research.md` /
  `semgrep-drift-ai-implementation-plan.md` — research and implementation plan
  for adding Semgrep as an opt-in `drift:ai` prototype advisory, with explicit
  rule-source licensing gates for registry, AGPL, and unknown-license packs.
  _(Implementation-plan slices all landed; the research note + plan are retained
  as the cited record. The first-party ai-footguns rule pack stays deferred.)_
- `useeffect-ai-agents-research.md` /
  `useeffect-guardrails-implementation-plan.md` — research on AI-agent
  `useEffect` misuse patterns (verified React-team guidance vs anecdote-tier
  agent mechanisms, plus a local audit) and a guardrail plan: no-new ratchet
  for the deferred `react-hooks/set-state-in-effect`, a gated
  `eslint-plugin-react-you-might-not-need-an-effect` trial, agent-facing
  effect guidance, and an explicit hard-ban rejection.
- `storybook-component-catalog.md` — parked plan for a Storybook (or lighter)
  component catalog over the 13 `packages/client/src/components/ui/` primitives,
  wired to the Tailwind v4 theme, plus a foundations page mirroring `DESIGN.md`.
  Surfaced during the 2026-06-01 design-system review; promote when the
  component surface or team size justifies the tooling. Companion deferred work:
  a WCAG contrast audit and `prefers-reduced-motion` handling.
- `codebase-audit/00-report.md` — 2026-06-13 read-only maintainability/onboarding
  audit; mostly implemented (updated 2026-06-20): 38/43 leaves Done & landed,
  3 partial (#08/#09/#24 server-layering), 2 open Proposals (#05, #20). Re-verify
  `file:line` and pull one open leaf at a time. Excludes the dup/dead-code lane
  (now
  `../finished_work/drift-ai-findings.md`) and already-tracked packs.
- `harness-strictness-comprehension-2026-06/00-index.md` — two proposal-only
  harness follow-ups from the 2026-06 research notes: ratchet the remaining
  TypeScript strictness flags (`exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`) with measured adoption, and add a short
  intent/comprehension prompt to the PR template while preserving
  `verify:changed`.
- `harness-research-followups-2026-06/00-index.md` — second round of
  proposal-only follow-ups from the harness research, after cross-checking each
  recommendation against what the repo already enforces. Four **ready** leaves:
  property-based tests for the rules engine (fast-check), token-aware design
  lint (arbitrary Tailwind / scoped raw hex), a codebase-grounded golden-task
  eval harness, and runtime a11y (axe-core) in the Playwright e2e suite. Three
  **design-gated, do-not-implement-yet** leaves with open questions: secret
  scanning (gitleaks/trufflehog), a PR diff-size warning, and a guardrail-config
  change tripwire (the last two shaped by this being a single-author repo).
  Index lists what is already covered elsewhere so nothing is double-proposed.
## Promotion rules

1. Promote only work that is ready now.
2. Move the note or folder back into `in_progress/`.
3. Add one line to `LOG.md` if context is needed.
