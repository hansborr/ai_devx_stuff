# Lint Adoption 2026-07 — Task Pack

Status: Task index
Created: 2026-07-15
Source: "What should Musi adopt?" (§4) of the 2026-07-15 lint-as-harness
research consolidating eight explorer reports over Musi, Factory AI's
`@factory/eslint-plugin`, and `eslint-plugin-llm-core`. Provenance,
adjudications, the P2 watchlist, and the unanimous non-recommendations:
[`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) — read that
first, especially before proposing anything lint-shaped that is not in this
pack (it may be deliberately rejected).

Each leaf is one small branch/commit-series unless it says otherwise. Every
`file:line` in the leaves was verified against HEAD (`801881ff`) on
2026-07-15; re-verify seams before implementing — paths drift.

Leaves 10–13 are the P0 tier (high agent impact, low architectural conflict);
20–25 are the P1 tier (clear value; tune to Musi conventions). Within a tier,
order is the report's; leaves are independent unless a dependency is noted.

## Task List

Tracks: **S** sensors/gates, **L** lint rules, **E** envelope/feedback.

| # | Task | Track | Priority | Size | Depends on | Status |
|---|---|---|---|---|---|---|
| 10 | [Wire the dormant near-duplicate detector into a ratcheted gate](./10-wire-near-duplicate-detector-into-a-ratcheted-gate.md) | S | P0 | M | none | Done |
| 11 | Tighten function length and add nesting depth | L | P0 | M | none | Done |
| 12 | [Broaden error-semantics coverage](./12-broaden-error-semantics-coverage.md) | L | P0 | S | none | Done |
| 13 | Extend the agent-diagnostics envelope beyond `local/*` | E | P0 | M | 11 helps (overlay covers its rules) | Done |
| 20 | Port the llm-core correctness bundle | L | P1 | S | none — can land any afternoon | Done |
| 21 | Effect-misuse enforcement (docs→lint conversion) | L | P1 | M | dialog-convention decision (parked notes linked in leaf) | Done |
| 22 | Message upgrades + message measurement | E | P1 | M | (a)/(b) none; (c) after 13 helps | Done |
| 23 | `no-commented-out-code` | L | P1 | S | none | Done |
| 24 | Security-primitive bundle | L | P1 | S | none | Done |
| 25 | `no-unbounded-promise-all`, server-scoped | L | P1 | S | none | Done |

## Recommended order

1. **Quick wins first:** 20 and 24 are zero-drain hard-error bundles; either
   is a one-afternoon leaf that shows motion.
2. **The flagship:** 10 (near-duplicate gate) — detection already exists;
   fixing the `buildListInput` clone plus the gate is the talk-ready demo.
3. **Structural pressure:** 11, then 13 so the newly tightened core rules
   speak through the agent envelope, then 12.
4. **The drains:** 21 (needs the dialog-convention decision) and 23 (needs
   the noise calibration); 22 and 25 whenever a lane is free.

## Promotion rules

1. Promote exactly one leaf into active work; read
   [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) first.
2. Reconfirm seams with `rg` / `bun run code:intel` before editing.
3. Rule tightenings that surface existing debt start as lint-ratchet entries
   per `docs/guides/lint-ratchet.md`; verified zero-findings tightenings land
   directly as hard errors.
4. New local rules follow `docs/guides/local-eslint-rules.md` registration,
   docs, and test surfaces; new sensors follow the knip-sensor
   baseline+merge-driver pattern.
5. When a leaf lands, mark its row Done here; durable context goes in the
   commit, not this index.
