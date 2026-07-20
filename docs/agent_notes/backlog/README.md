# Backlog

Status: Living reference index
Updated: 2026-07-19

Parked workstreams that still matter, but should stay out of the default
agent loop.

Do **not** read this folder at session start. Promote an item back into
`in_progress/` only when the active loop empties or a human reprioritizes it.

## Ready queue

- `ready-2026-07/00-index.md` — the single tracking surface for everything
  verified ready-to-work at the 2026-07-19 whole-backlog readiness sweep
  (8-agent verification against HEAD). Standalone ready notes were moved
  into that pack; ready leaves that live in other packs are tracked there
  by reference. Pull work from it instead of re-triaging the parked items
  below; when something lands, mark it Done there and in its source pack.

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
  harness review and selected backlog overlaps (reconciled 2026-07-19: five
  "Parked" rows — 10/13/14/16/53 — turned out to have landed 2026-06/07 and
  their leaves were removed). The six genuinely open leaves
  (15/25/50/51/52/54) are tracked in the ready queue; older AI-harness notes
  remain rationale.
- `scripts-flat-family-reorg.md` — decide whether the flat
  `lint-coverage-map-check*`, `client-test-isolation*`, and
  `sensor-knip-unused-exports*` script families should move under directories
  or become sanctioned top-level exceptions.
- `worktree-local-observability.md` — parked local dev-session observability
  plan; the fixture-backed `logs:audit` quality checks landed, while capture
  directories and a log inspector remain unpromoted.
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
- `fast-uri-override-removal.md` — drop the transitive `fast-uri` 3.1.2
  `overrides` pin once upstream chains stop pinning the vulnerable 3.1.0.
  Enforced by `scripts/check-fast-uri-override.sh` (wired into `audit:deps` and
  CI), so promotion is triggered by a failing watchdog, not a calendar.
- `eslint-react-peer-exception-removal.md` — drop the ESLint 10 peer exception
  for `eslint-plugin-react` / `eslint-plugin-jsx-a11y` once both ship an ESLint
  `^10` peer. Enforced by `scripts/check-eslint-react-peer-exception.sh` (wired
  into `audit:deps` and CI), so promotion is triggered by a failing watchdog.
- `cache-budget-followups.md` — conditional verification-budget work: typecheck
  optimization only if measurements justify it, per-test slow helpers, async
  e2e design, and future Stop-reporter guardrails.
- `slow-test-tier-candidates.md` — Tier 3 of the 2026-06 test-runtime work:
  valuable-but-slow server concurrency tests + heavy `scripts` meta-tests to
  move into the slow tier (and the `test-lint-ratchet.sh` smoke, which needs
  new slow-smoke plumbing). Behavior change, so deferred; promote only if more
  per-commit time still needs trimming. Includes a coverage-threshold caveat.
- `character-sheet-load-error-after-return.md` — unreproduced load-error
  report; queued as a timeboxed repro spike in the ready queue (A14).
- `ai-hooks-suite-self-concurrency.md` — the ai-hooks test suite races
  itself via the shared repo-root `.allow-protected-edits` marker; low
  urgency, but needs a three-way owner scope call (document / private
  marker / flock) before any parallel-suite use.
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
- `semgrep-drift-sensor-research.md` /
  `semgrep-drift-ai-implementation-plan.md` — research and implementation plan
  for adding Semgrep as an opt-in `drift:ai` prototype advisory, with explicit
  rule-source licensing gates for registry, AGPL, and unknown-license packs.
  _(Implementation-plan slices all landed; the research note + plan are retained
  as the cited record. The first-party ai-footguns rule pack stays deferred.)_
- `join-page-auto-join-ux-decision.md` — parked product/UX decision for invite
  links: keep auto-join but move it out of a component effect, or require an
  explicit "Join campaign" confirmation before mutating.
- `storybook-component-catalog.md` — parked plan for a Storybook (or lighter)
  component catalog over the 13 `packages/client/src/components/ui/` primitives,
  wired to the Tailwind v4 theme, plus a foundations page mirroring `DESIGN.md`.
  Surfaced during the 2026-06-01 design-system review; promote when the
  component surface or team size justifies the tooling. Companion deferred work:
  a WCAG contrast audit and `prefers-reduced-motion` handling.
- `codebase-audit/00-report.md` — 2026-06-13 read-only maintainability/onboarding
  audit; reconciled 2026-07-13: 38 landed leaves removed, 3 remain partial
  (#08/#09/#24 server-layering), 2 open Proposals (#05, #20). Re-verify
  `file:line` and pull one open leaf at a time. Excludes the dup/dead-code lane
  (now `../finished_work/drift-ai-findings.md`) and already-tracked packs.
- `harness-strictness-comprehension-2026-06/00-index.md` — two harness
  follow-ups from the 2026-06 research notes (reconciled 2026-07-19). HC-1
  PR comprehension template landed `1fdea456`; HS-1 is half-landed —
  `noFallthroughCasesInSwitch` and `noImplicitOverride` shipped 2026-06-22,
  and the residue (a measurement-first discovery pass for
  `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`) is
  in the ready queue.
- `lint-messaging-2026-07/00-index.md` — 1-leaf residue of the 2026-07-05
  lint-messaging review (reconciled 2026-07-13): the envelope↔hook bridge's
  deferred step (b). Everything else in the 21-leaf pack landed.
- `lint-deep-dive-2026-07/00-index.md` — 7-leaf residue of the 2026-07-04
  lint deep-dive (triaged 2026-07-19): proposed/parked/design-gated
  follow-ups — propose-mode registry validation, scheduler cancellation,
  shared collection design, additive restricted-syntax composition,
  suppression registers into the commit gate, portable engine context, and
  lint-lane memory profiling. (Type-program partitioning, leaf 76, landed
  2026-07-14 — `d714f4ce`; ratchet docs accuracy, leaf 70, landed
  2026-07-16 — `9e8bd211`.)
- `harness-review-2026-07/00-index.md` — 2-leaf residue of the 2026-07-01
  AI-harness review (re-verified 2026-07-19; was 36). The ratchet
  merge-conflict lane, ratchet platform, new lint rules, and hooks landed
  2026-07-12..2026-07-15; 38 (`strict-boolean-expressions` services slice,
  `7135e5a0`) and 74 (cadence rules → `AGENTS.md`, `c62c2f3b`) turned out to
  have landed 2026-07-02 and their leaves were removed (git history). Open
  residue: 35 boundary half and 36, both design-gated on owner decisions.
  Rejected verdicts recorded in `01-sources-and-verdicts.md`.
- `harness-sweep-2026-07/00-index.md` — 1-leaf residue of the 2026-07-11
  multi-model sweep (triaged 2026-07-19; was 40): checkJs gate / shared
  policy-shim parity. The knip dead-export floor drain (`4bb0b024`) and
  worktree-aware commit guards (drain 1.5) landed and their leaves were
  removed. Sweep design and the 59-item kill list remain in
  `00-sources-and-verdicts.md`.
- `harness-research-followups-2026-06/00-index.md` — second round of
  follow-ups from the harness research (reconciled 2026-07-19: DL-1
  token-aware design lint and A11Y-1 axe-core e2e both landed 2026-06-22).
  Open: EV-1 codebase-grounded golden-task eval harness, plus PB-1's small
  residue (`attack-damage.ts`/`xp.ts` property suites) — both in the ready
  queue. Three **design-gated, do-not-implement-yet** leaves with open
  questions: secret scanning (gitleaks/trufflehog), a PR diff-size warning,
  and a guardrail-config change tripwire (the last two shaped by this being
  a single-author repo). Index lists what is already covered elsewhere so
  nothing is double-proposed.
- `lint-adoption-2026-07/00-index.md` — 10-leaf adoption pack from the
  2026-07-15 lint-as-harness research (Musi vs Factory vs llm-core); all 10
  leaves landed (merged via `ab318d05` / `4528e972`): P0 =
  near-duplicate gate, function-length/nesting tightening, error-semantics
  siblings, envelope overlay for core rules; P1 = llm-core correctness
  bundle, effect-misuse enforcement, message upgrades/evals,
  `no-commented-out-code`, security primitives, unbounded `Promise.all`.
  Non-recommendations and the P2 watchlist live in
  `01-sources-and-verdicts.md`.
- `lint-review-followups-2026-07/00-index.md` — follow-up pack from the
  2026-07 lint review cycle; all leaves are Done or superseded except leaf
  02, the near-duplicates detector v2 (advisory block-detection tier
  first) — in the ready queue.
- `lint-arch-review-2026-07/00-index.md` — residue of the 2026-07-16
  five-model architecture review of the lint system (reconciled 2026-07-19).
  Landed 2026-07-16..18: the P0 kernel migration, metric strategies,
  merge-driver shell body, rule-source identity hardening, validation/CLI
  idiom, docs split, `report-only` trim, kernel diagnostics parity, **leaf 02
  package seam** (`@musi/lint-ratchet` in `tools/lint-ratchet/`, merged
  `6e685069`), and **leaf 05 engine consolidation**. Open residue: leaf 14
  enumerated subpath exports (owner-accepted, in the ready queue), leaf 07
  coverage map as data (trigger: next checker schema change), leaf 13 full
  CLI driver (gated on a third adapter + owner ruling).
- `sequential-drain-2026-07/00-index.md` — 2026-07-15 consolidation pack,
  fully drained: all 24 numbered leaves across its five phases landed by
  2026-07-16. Still useful for two things: `01-verification-record.md`'s
  landed-leaf list and exclusion verdicts (check it before promoting from
  the older packs above), and the post-drain follow-ups in
  `03-phase3-review-followups.md` / `04-phase45-review-followups.md`, whose
  open items (F.1.1–F.1.3, F.2.1) are tracked in the ready queue.
- `arch-plans-2026-07/00-index.md` — 2026-07-19 cross-reviewed intake pack: six
  plans drafted in the sibling checkout's 2026-07-17/18 architecture reviews,
  each fact-checked and verdicted by both Fable 5 and GPT-5 codex before
  intake, with the surviving fixes applied. DRAINED 2026-07-19: leaves 01, 02,
  03, 05 (harness) and 06 (turn-movement server origin) all landed the same
  day via cross-reviewed lanes; only leaf 04 (contested sensor-baseline merge)
  remains, deliberately unscheduled behind its double trigger. A seventh
  candidate (coverage-map spoke fold) was not adopted; its residue is a rider
  in `lint-arch-review-2026-07/07-*.md`.
- `arch-review-2026-07/00-report.md` — 2026-07-06 whole-repo architectural
  review, fully closed (re-verified 2026-07-19): #12's last deferred piece
  (the baseline git-attributes merge-driver wiring) landed via the
  merge-driver field exercise 2026-07-16, the bash-vs-TS substrate ruling
  (#13) closed with owner sign-off 2026-07-14 (recorded in
  `docs/ai-harness.md`), and the other ranked refactor tiers landed.
  Retained as the review record.

## Promotion rules

1. Promote only work that is ready now.
2. Move the note or folder back into `in_progress/`.
3. Add one line to `LOG.md` if context is needed.
