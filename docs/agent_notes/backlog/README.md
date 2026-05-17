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
- `lint-hardening-cross-repo-review.md` + `lint-hardening/` — parked
  lint-hardening index and leaf notes from a Rust/Clippy vs Musi ESLint
  comparison. Promote one leaf at a time; start with zero-warning cleanup,
  changed-gate content correctness, then Vitest lint evaluation.
- `agent-hook-git-safety.md` — implemented source plan for the shared
  agent-hook policy blocks on history rewrites, force pushes, force
  branch/tag deletion, dangerous `gh` mutations, and raw `grep` (context
  hygiene). Rollout note:
  `docs/agent_notes/in_progress/agent-hook-git-safety.md`.
- `drift-ai-current-findings.md` — 2026-05-10 triage of the first
  `drift:ai --scope current` report: current ghost-file tuning plus duplicate
  refactor candidates for token mutations, cursor lists, test contexts, token
  forms, selectable cards, sheet rows, codemods, and homebrew fields.

## Promotion rules

1. Promote only work that is ready now.
2. Move the note or folder back into `in_progress/`.
3. Add a one-line snapshot entry in `STATUS.md`.
4. Add only the ready-now leaf slice to `NEXT.md`.
