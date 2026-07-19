# 1. Sources, convergence, and recorded verdicts

Status: Shared context for this pack — read before promoting any leaf.
Created: 2026-07-01

## Provenance

This pack synthesizes four independent 2026-07-01 reviews of the Musi AI
harness, requested with the explicit goal of making the repo a public
reference for harness engineering:

1. **Harness surface map** (Claude subagent) — full inventory of
   `harness.controls.json`, `.claude/`, `.husky/`, `scripts/ai-hooks/`,
   `scripts/harness*`, and the docs-as-guardrails mechanisms.
2. **Lint + ratchet deep-dive** (Claude subagent) — taxonomy of the local
   rule plugin, ratchet internals, and a stack-specific gap analysis.
3. **Web research** (Claude subagent) — 2025–2026 harness-engineering
   practice: current Claude Code hook-event list, Stop-gate patterns,
   bypass-guard prior art, `imbue-ai/ratchets`, `nizos/tdd-guard`,
   nested-AGENTS.md adoption. Key sources: Anthropic engineering posts on
   long-running-agent harnesses, code.claude.com hooks reference,
   factory.ai "Using Linters to Direct Agents".
4. **Codex second opinion** (`codex exec`, four subagents) — independent
   review of the same three focus areas plus reference-fitness risks.

A separate motivating input for the 10–13 merge lane: the pack owner
adopted this ratchet design in another multi-contributor, high-debt repo
and hit **frequent baseline merge conflicts** in day-to-day work.

## Convergence (independent agreement = strongest promotion signal)

- **Lifecycle hook events missing** (leaves 50–52): found independently by
  the surface map, Codex, and the web research; the repo's own
  `docs/agent_notes/harness-engineering-research/12-custom-hooks.md`
  already recommends them.
- **tRPC error-code rule** (leaf 32), **query-key discipline** (leaf 33),
  **permissive-schema ban** (leaf 34): each proposed independently by the
  deep-dive and Codex.
- **Merge-driver operational gaps** (leaves 10–12): user field experience +
  Codex (health check) + web research (imbue min-on-merge prior art).

## Evaluated and rejected (recorded so nothing re-proposes them blind)

- **Router-thinness rule (`no-router-prisma-writes`)** — contested: Codex
  proposed it ratchet-first; the deep-dive recommended against (~175
  `prisma.` references in routers; "complex logic in services" is a
  judgment call, so the rule is mostly noise). Verdict: not proposed.
  `local/max-lines` pressure on fat routers stays the mechanism. Revisit
  only with a measured false-positive rate from a prototype.
- **Client socket event-name rule** — already closed by types:
  `packages/client/src/hooks/socket-context.tsx` types the socket as
  `Socket<ServerToClientEvents, ClientToServerEvents>`; server side is
  `local/socket-registry-broadcasts`.
- **`no-floating-promises` with `ignoreVoid: false`** — fights the
  idiomatic `void queryClient.invalidateQueries(...)` pattern (~53
  callsites). A void-boundary marker rule would be consistent with house
  style but poor value/noise today.
- **`no-await-in-loop`** — sequential awaits are frequently intentional in
  this domain; report-only at best, not proposed.
- **Zod↔Prisma drift lint** — not an ESLint-shaped problem; runtime
  `.output()` validation (enforced by `local/trpc-require-output-schema`)
  plus a drift-ai family sensor is the right home.
- **i18n/hardcoded-string lint** — no i18n framework; not applicable.
- **eslint-plugin-unicorn / eslint-plugin-security wholesale** — high
  churn; secret scanning is tracked (design-gated) in
  `../harness-research-followups-2026-06/`.

## Noted, not promoted (interesting; no leaf in this pack)

- **TDD enforcement hook** (`nizos/tdd-guard` pattern: block implementation
  edits without a failing test). Deterministic version of the AGENTS.md
  "Use TDD" line, but a large behavioral change to the edit loop; park
  until the softer gates in this pack (55, 56) prove out.
- **Changed-file mutation testing in the interactive loop**
  (`git diff --name-only` → scoped Stryker). Overlaps the scheduled-lane
  Stryker item already tracked in `../harness-presentation-2026-06/`;
  promote there first.
- **`WorktreeCreate` hook event** — could eventually replace the
  `bun run dev` → `worktree:init` provisioning trigger; note only, since
  the current path works and is tested.

## Already tracked elsewhere (do not duplicate here)

- **SessionStart state rehydration** →
  `../harness-presentation-2026-06/` improvement item (R11). Leaf 50 in
  this pack is its structural prerequisite (wiring-schema support).
- **Secret scanning, PR diff-size warning, guardrail-config tripwire** →
  `../harness-research-followups-2026-06/00-index.md` (design-gated
  leaves there).
- **`useEffect` guardrails** → the standalone
  `useeffect-guardrails-implementation-plan.md` note (implemented via
  lint-adoption-2026-07 leaf 21; removed at the 2026-07-19 triage — git
  history); leaf 36 here proposes a different mechanism (marker rule) and is
  design-gated on reconciling with that plan.
