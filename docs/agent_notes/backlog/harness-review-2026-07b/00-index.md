# Harness Review 2026-07b — Task Pack

Status: Parked task index (20 surviving leaves)
Created: 2026-07-06
Source: 2026-07-06 AI-harness deep dive (five parallel Sonnet audit agents
→ nine sub-reports, adversarially verified by a Codex consult: 7
CONFIRMED / 5 PARTLY / 0 REFUTED + 2 Codex-original findings). Provenance
and dropped/corrected claims:
[`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) — read that
first. Second pack of the month; the first
([`../harness-review-2026-07/`](../harness-review-2026-07/00-index.md))
is fully landed and these leaves were de-duplicated against it.

Each leaf is one small commit (leaves that bundle a rider say so inside).
File:line references were verified against HEAD `db70e9a7` on 2026-07-06;
re-verify seams before implementing — paths drift.

What this review found *sound* (do not spend leaves re-checking):
instruction files (zero false claims), the generation spine (byte-exact
`--check`s, injection-hardened quoting, script-existence cross-checks),
lock/atomic-write discipline across `ai-hooks`, and the agent-cli test
suite. The leaves below are targeted gaps, not redesign.

## Task List

Tracks: **PG** policy guards, **QW** quiet wrappers, **SP** stop/session
policy, **VP** verify pipeline, **AC** agent-cli, **DH** docs/hygiene.

| # | Task | Track | Size | Severity | Depends on | Status |
|---|---|---|---|---|---|---|
| 10 | [protected-files deny tier bypassable via Bash writes](./10-protected-files-bash-write-bypass.md) | PG | M | high | none | Open — leaf says not implemented |
| 11 | [Anchor DB CLI checks; docker prefix blind spot](./11-db-cli-anchoring-and-docker-prefixes.md) | PG | S-M | high | none | Open — leaf says not implemented |
| 12 | [Destructive git guards miss global options](./12-git-global-options-bypass-destructive-guards.md) | PG | S | high | none | Open — leaf says not implemented |
| 13 | [Worktree-loss policy parity for Codex/Copilot](./13-worktree-loss-policy-parity-codex-copilot.md) | PG | S-M | high | 11 (helpers) | Open — leaf says not implemented |
| 14 | [CMD_START grammar gaps: widen or document](./14-cmd-start-grammar-gaps-decision.md) | PG | M | med | decision gate | Decided 2026-07-07 — option (a) recorded in leaf; implementation dispatched |
| 20 | [Clamp quiet-wrapper watchdogs below hook timeout](./20-quiet-wrapper-timeout-clamp.md) | QW | S | med | none | Open — leaf says not implemented |
| 21 | [Orphan child on SIGKILLed bun-run-quiet](./21-bun-quiet-orphan-child-on-sigkill.md) | QW | M | med | pair with 20, 22 | Open — leaf says not implemented |
| 22 | [process-runner.sh dead code: wire or delete](./22-process-runner-dead-code.md) | QW | S | low | decide with 21 | Open — leaf says not implemented |
| 23 | [prisma-generate flock error handling](./23-prisma-generate-flock-error-handling.md) | QW | S | low-med | none | Open — leaf says not implemented |
| 30 | [SubagentStop init + degenerate scope key](./30-subagent-stop-init-and-scope-key.md) | SP | S-M | med | none | Open — leaf says not implemented |
| 31 | [Stop-hook live ESLint vs 30s budget](./31-stop-lint-warnings-budget.md) | SP | S-M | med | none | Open — leaf says not implemented |
| 32 | [session-state kill-switch listing + matcher](./32-session-state-kill-switch-listing.md) | SP | S | low-med | check R11 overlap | Open — leaf says not implemented |
| 40 | [Harness freshness gate in land.sh](./40-land-harness-freshness-gate.md) | VP | S-M | high | none | Open — leaf says not implemented |
| 41 | [De-dup dist-defer dispatch + typecheck assertion](./41-dist-defer-dedup-and-typecheck-assertion.md) | VP | M | med | none | Open — leaf says not implemented |
| 42 | [Assert verify ⊇ pre_commit slot sets](./42-verify-superset-assertion.md) | VP | S | med | none | Open — leaf says not implemented |
| 43 | [Surface classifier-uncertainty scripts skip](./43-classifier-skip-visibility.md) | VP | S | low | none | Open — leaf says not implemented |
| 44 | [Bind manifest dynamic resolvers to steps-lib cases](./44-dynamic-resolver-binding-check.md) | VP | S | low-med | none | Open — leaf says not implemented |
| 50 | [agent-run.sh signal race + trailer ambiguity](./50-agent-run-signal-race.md) | AC | M | med-high | none | Open — leaf says not implemented |
| 60 | [Instruction-surface discovery gaps](./60-instruction-pointer-gaps.md) | DH | S | low | none | Open — leaf says not implemented |
| 61 | [Temp-file leak + stop-state GC](./61-result-command-temp-leak-and-stop-state-gc.md) | DH | S | low | none | Open — leaf says not implemented |

## Recommended Order

1. **Enforcement-gap lane (high severity, independent):** 40 (three
   agents converged on it; smallest blast radius) → 10 → 12 → 11 → 13
   (13 builds on 11's executable-position helpers).
2. **Robustness pairs:** 20 then 21+22 together (one decides the other's
   shape); 50 standalone; 30 and 31 standalone.
3. **Meta-guards, cheap:** 42 → 44 → 43 → 23 → 32.
4. **Refactor when touching the area anyway:** 41 (largest diff, no
   behavior change — schedule with other verify work).
5. **Design-gated:** 14 needs its widen-vs-document decision recorded in
   the leaf before implementation.
6. **Docs sweep anytime:** 60, 61.

## Promotion Rules

1. Promote exactly one leaf into active work; read
   [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) first —
   several breadth-pass claims were corrected there and must not be
   reintroduced.
2. Reconfirm seams with `rg` / `bun run code:intel` before editing.
3. Policy-guard leaves (10-14) keep the fail-closed bias and the "no full
   shell parsing" precedent from the prior pack's leaf 53; every guard
   change ships with both-direction fixtures in `scripts/ai-hooks/test.sh`.
4. Hook wiring or timeout changes go through `harness.controls.json` +
   regeneration, never hand-edits to `.claude/settings.json`.
5. When a leaf lands, mark its row Done here; move durable context to the
   commit message, not this pack.
