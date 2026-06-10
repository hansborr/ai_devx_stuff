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
- `drift-ai-ghost-files-agent-noun-pairs.md` — parked detector-tuning follow-up
  from the 2026-06-05 field-run calibration: reviewed current-scope
  `ghost-files` false positive for intentional `evaluation`/`evaluator` role
  siblings.
- `drift-ai-next-items/00-index.md` — post-ship drift:ai task pack created after
  rechecking the backlog against the live implementation. Use this for remaining
  diagnostics/fusion work, small drift:ai hardening/check additions, and
  prototype-only clone/dead-code/ownership ideas.
- `semgrep-drift-sensor-research.md` /
  `semgrep-drift-ai-implementation-plan.md` — research and implementation plan
  for adding Semgrep as an opt-in `drift:ai` prototype advisory, with explicit
  rule-source licensing gates for registry, AGPL, and unknown-license packs.
- `storybook-component-catalog.md` — parked plan for a Storybook (or lighter)
  component catalog over the 13 `packages/client/src/components/ui/` primitives,
  wired to the Tailwind v4 theme, plus a foundations page mirroring `DESIGN.md`.
  Surfaced during the 2026-06-01 design-system review; promote when the
  component surface or team size justifies the tooling. Companion deferred work:
  a WCAG contrast audit and `prefers-reduced-motion` handling.

## Promotion rules

1. Promote only work that is ready now.
2. Move the note or folder back into `in_progress/`.
3. Add one line to `LOG.md` if context is needed.
