# Lint Messaging 2026-07 — Task Pack

Status: Closed 2026-07-19 — leaf 22 step (b) landed on auto/ready-b-hooks; no open leaves remain.
Created: 2026-07-05
Source: 2026-07-05 lint-messaging review (5 parallel Sonnet exploration
agents — local rules, agent envelope/hooks, ratchet, gates, sensors — with
Fable synthesis and spot-verification of the highest-impact claims).
Provenance, verified-claim list, one corrected claim, and deliberate
exclusions: [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) —
read that first.

Scope: the *messages* the lint systems emit to agents — clarity,
truthfulness, discoverability of fix guidance, and consistency. Not gate
wiring, not rule semantics. The review's overall verdict was that the
surface is unusually strong (contract-tested rule messages, single-sourced
recovery commands, no stale command references found anywhere); these
leaves are the residual seams.

Each leaf is one small commit unless it says otherwise. file:line refs
were collected 2026-07-05; leaves marked Confidence: high were re-verified
against HEAD during synthesis, the rest are report-sourced — reconfirm
seams with `rg` before editing.

## Task List

Tracks: **T** truthfulness (silent/misleading paths), **D** discoverability
of existing guidance, **A** audit-lane actionability, **N**
noise/consistency polish.

| # | Task | Track | Size | Severity | Depends on | Status |
|---|---|---|---|---|---|---|
| 22 | [Bridge edit-time hook advisories to the envelope guidance](./22-envelope-hook-bridge.md) | D | M | high | none | Done (steps (a) and (b)) |

## Recommended Order

1. **Truthfulness first:** 10 (an agent currently reads a skipped-slot
   commit as fully verified), then 11, 12, 13 — all small, all cheap.
2. **Discoverability core:** 22 (highest leverage — the rich envelope
   guidance is undiscoverable from the hooks that actually fire), then
   20 → 21 (21's new assertions would fail before 20 lands), 23, 24.
3. **Audit-lane:** 30 (needs the allowlist-vs-pointer decision recorded
   first), 31 anytime.
4. **Polish:** 40–47 and 49 in any order; 48 last — it is gated on an
   explicit owner decision written inside the leaf.

## Promotion Rules

1. Promote exactly one leaf into active work; read
   [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) first.
2. Reconfirm seams with `rg` / `bun run code:intel` before editing —
   Confidence: med leaves were not re-verified against HEAD.
3. Rule-message edits must keep the `message-guidance.test.js` contract
   green (shape, caps, action verbs) and update rule-test fixtures plus
   `docs:lint-guidance` output where messages are embedded.
4. Envelope/schema changes (42) must stay additive — harness-diagnostics
   JSON has consumers beyond lint (`verify-logs --json`).
5. When a leaf lands, mark its row Done here **and** update the leaf's own
   Status line (leaf 13 exists because a sibling pack skipped that step).

## Considered, not promoted

- **Generated-surface freshness locally warn-only / `harness:check`
  CI-only** — deliberate advisory-first policy, and the original claim was
  overstated (see corrections in 01). Revisit only if CI-time discovery
  recurs in practice.
- **`no-arbitrary-tailwind-value` suppression guidance** — needs a prior
  decision on whether a sanctioned override path exists at all; message
  work is downstream of that.
- **EXEMPT message-shape inconsistency** (`no-barrel` terse vs
  `no-redundant-central-mock` full prose, both autofix-adjacent) — cosmetic;
  revisit if the exempt list grows.
- **Catch-all `pairedGuide` quality** (7 rules point at
  `local-eslint-rules.md`, which lacks sections for most of them) — leaf 21's
  shared-guide flag surfaces it; writing the missing guide sections is
  docs work beyond this pack's messaging scope.
- **Dual "which files changed" implementations**
  (`lint-agent-changed.sh` vs `ai-hooks/edited-paths.sh`) — likely
  intentional (branch-scope vs tool-call-scope); a comment cross-linking
  them would do, no message change involved.
- **`lint-coverage-check.sh` per-file bun spawns lack a target cap**
  (unlike `AI_RATCHET_REGRESSION_MAX_TARGETS`) — performance, not
  messaging; unverified.
- **`EXEMPT_SCRIPTS` allowlist asymmetry in `harness-check.ts`** — comment-
  only candidate, negligible risk.
- **`lint-config-sensors.sh` emits raw yamllint/hadolint output** — the one
  sensor whose finding shape is third-party; wrapping it buys little.
- **`docs/guides/lint-ratchet.md` table of contents** (1146 lines) — docs
  ergonomics, not messaging.
- **`lint-agent.ts` header pointer to the advisory-not-gate rationale** —
  one-comment candidate, fold into any leaf touching that file.
