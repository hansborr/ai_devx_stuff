# Lint Deep-Dive 2026-07 — Task Pack

Status: Drained 2026-07-04 — implemented across five unmerged branches (see
Drain Status below); awaiting owner review + integration. Rows updated to
reflect per-branch reality.
Created: 2026-07-04
Source: 2026-07-04 lint deep-dive (3 parallel Codex xhigh lanes: ratchet /
configs+rules / pipeline, plus Claude gate-trace and claim-verification
agents). Provenance, verdict adjustments, and deliberate exclusions:
[`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) — read that
first.

Each leaf is one small commit unless it says otherwise. Every file:line in
the leaves was verified against HEAD (`367a24aa`) on 2026-07-04; several
Codex claims were adjusted during verification — where a leaf and a raw
finding disagree, trust the leaf. Re-verify seams before implementing; paths
drift.

Owner priority (2026-07-04 session): leaf 50 — the suppression-register gap
was independently raised as a live concern ("if an agent disabled a rule
in-file, would anything fail?"). Companion leaf 54 (added by the same-day
review pass) is the ratchet-side half of that question.

## Task List

Tracks: **R** ratchet correctness, **P** performance, **L** local-rule
correctness, **C** config architecture & registration, **G** gate wiring,
**I** inventory floors, **D** docs & portability.

Status legend: **Done** = implemented + reviewed on the named branch;
**Design recorded** = design-gated leaf whose decision is written into the leaf,
implementation intentionally deferred for owner review; **Parked/Trim** =
deliberately not done. Branch short names: **gate** =
`fix/lint-gate-suppression-lane`, **rules** = `fix/lint-rule-holes-lane`,
**alias** = `fix/lint-alias-binding-lane`, **ergo** =
`fix/lint-ergonomics-lane`, **ratchet** = `fix/lint-ratchet-correctness-lane`.

| # | Task | Track | Size | Severity | Depends on | Status |
|---|---|---|---|---|---|---|
| 10 | [Post-merge truth-up misses semantic staleness](./10-postmerge-truthup-semantic-staleness.md) | R | M | high | pairs with 12 | Done — ratchet |
| 11 | [`ruleSourceHash` ignores transitive helpers](./11-rulesource-hash-transitive-helpers.md) | R | M | med (latent high) | none | Done — ratchet |
| 12 | [Semantic merge drops `messagesFingerprint`](./12-semantic-merge-drops-fingerprints.md) | R | S | med | pairs with 10 | Done — ratchet |
| 13 | [Debt accounting into the commit gate](./13-debt-accounting-into-commit-gate.md) | R | S-M | med | none | Done — gate |
| 14 | [`--propose` bypasses registry validation](./14-propose-mode-skips-registry-validation.md) | R | S | low-med | none | Not done (trim candidate — left Proposed) |
| 15 | [Structured codes for drift classification](./15-structured-drift-error-codes.md) | R | S | low | none | Done — ratchet |
| 16 | [Scheduler cancellation of ESLint workers](./16-scheduler-cancellation.md) | R | M | low-med | none | Parked (2026-07-04) |
| 20 | [Shared heap policy for all gates](./20-shared-heap-policy.md) | P | M | high | none | Done — gate |
| 21 | [`--cache` for the main ESLint lane](./21-eslint-cache-normal-lint.md) | P | S-M | med-high | none | Done — gate |
| 22 | [Zero-baseline config-resolution memoization](./22-zero-baseline-config-resolution-memoization.md) | P | S-M | low-med | none | Done — gate |
| 23 | [Shared-collection design (4 spawns/gate)](./23-shared-collection-design.md) | P | L | med | 21, 22 measured first; DESIGN-GATED | Design recorded (option c: keep per-slot caching, do not build shared collection) — gate |
| 30 | [Raw-SQL fence computed-property bypass](./30-raw-sql-fence-computed-property-bypass.md) | L | S | high | none | Done — rules |
| 31 | [Concurrency-guard alias bypass](./31-concurrency-guard-alias-bypass.md) | L | M | med-high | shared helper w/ 32/36/38 | Done — alias |
| 32 | [Outer-client nested-param exemption](./32-outer-client-nested-param-exemption.md) | L | M | med-high | shared helper w/ 31 | Done — alias |
| 33 | [Broadcast rule misses direct `.emit`](./33-broadcast-in-transaction-direct-emit.md) | L | S | med-high | none | Done — rules |
| 34 | [Schema-guard escape forms](./34-strict-shared-schemas-escape-forms.md) | L | M | med | selector half w/ 30 | Done — alias |
| 35 | [`throw Error(...)` call form](./35-plain-error-call-form.md) | L | S | med | none | Done — rules |
| 36 | [Output-schema rule alias bypass](./36-trpc-output-schema-alias-bypass.md) | L | M | med | shared helper w/ 31 | Done — alias |
| 37 | [Socket-cleanup FALSE POSITIVE on member events](./37-socket-cleanup-false-positive-member-events.md) | L | M | med (latent) | none | Done — rules |
| 38 | [Async-array consumption keyed by bare name](./38-async-array-callbacks-name-keying.md) | L | M | med | builds shared helper | Done — alias |
| 40 | [Additive `no-restricted-syntax` composition](./40-restricted-syntax-additive-composition.md) | C | S+L | med | test first; builder DESIGN-GATED | Done step 1 (test) + design recorded step 2 (builder) — ergo |
| 41 | [Config-surface manifest (3 sources of truth)](./41-config-surface-manifest.md) | C | M | med | coordinate w/ 60 | Done — ergo |
| 42 | [Smoke-subject single-sourcing](./42-smoke-subject-single-sourcing.md) | C | M | med | none | Done — ergo |
| 50 | [Suppression registers into the commit gate](./50-suppression-registers-into-commit-gate.md) | G | M | med-high | none · OWNER PRIORITY | Done steps 1+3; step 2 (ledger) design recorded, impl deferred — gate |
| 51 | [CI consumes the generated gate manifest](./51-ci-consumes-generated-manifest.md) | G | M | med | none | Done — gate |
| 52 | [Config sensors accumulate failures](./52-config-sensors-accumulate-failures.md) | G | S | low | none | Done — gate |
| 53 | [lint-agent / guidance-check wiring decision](./53-lint-agent-guidance-check-wiring.md) | G | S | low-med | none | Done — gate |
| 54 | [Inline disables launder ratchet debt into tightenings](./54-inline-disables-launder-ratchet-debt.md) | G | S | med-high | pairs with 50 | Done — gate |
| 60 | [Coverage-map conflict detection (+ live fix)](./60-coverage-map-conflict-detection.md) | I | M | med | none | Done — ergo |
| 61 | [Knip identity baseline](./61-knip-identity-baseline.md) | I | M | med | ledger design w/ 50 | Design recorded (identity-ledger, w/ 50 step 2), impl deferred — gate |
| 70 | [Ratchet doc accuracy sweep + split decision](./70-ratchet-docs-accuracy-and-shape.md) | D | M | low-med | item 3 DESIGN-GATED | Done items 1-2 + design recorded item 3 (split) — rules |
| 71 | [Portable engine context (milestone 2)](./71-portable-engine-context.md) | D | L | med | DESIGN-GATED; after 15 helps | Design recorded (keep in-tree, thread context; no extraction now) — rules |
| 72 | [Single-rule probe command](./72-single-rule-probe-script.md) | D | S | low | respects 42 | Done — ergo |

## Drain Status (2026-07-04)

The pack was drained the same day it was created, orchestrated across parallel
Codex lanes with layered review (Codex implement → Codex review → Codex fix →
Claude second-layer review → spot-check). **27 leaves fully implemented, 4
design-gated leaves recorded their decision (23, 61, 71, plus the design halves
of 40/50/70), 2 deliberately not done (14 trim, 16 parked).** Nothing is merged;
all branches await owner review.

Five unmerged branches, all off `main` @ `e3f9f5eb`:

| Branch | Commits | Leaves |
|---|---|---|
| `fix/lint-gate-suppression-lane` | 24 | 13, 20, 21, 22, 23(design), 50(steps 1+3), 51, 52, 53, 54, 61(design) |
| `fix/lint-rule-holes-lane` | 11 | 30, 33, 35, 37, 70(1-2 + item-3 design), 71(design) |
| `fix/lint-alias-binding-lane` | 12 | 31, 32, 34, 36, 38 |
| `fix/lint-ergonomics-lane` | 13 | 40(step 1 + step-2 design), 41, 42, 60, 72 |
| `fix/lint-ratchet-correctness-lane` | 10 | 10, 11, 12, 15 |

Integration (verified 2026-07-04 by non-destructive `git merge-tree`
simulation of the full sequential `--no-ff` sequence): merge in the order
gate → rules → alias → ergo → ratchet. Merges 1, 2, 3, and 5 are **clean**;
only merge 4 (ergo) conflicts, on five files, all union / take-both:
`.husky/pre-commit`, `docs/agent_notes/lint-coverage-map.md`,
`scripts/harness-check.ts`, `scripts/tests/test-dependency-freshness.sh`,
`scripts/tests/test-harness-check.sh`. After merge 4, regenerate
`docs/generated/harness-controls.md` and reconcile the coverage-map prose
counts, then run `harness:check`. Land via full sequential `verify`
(`scripts/land.sh` conventions) with the fast-commit marker removed. This
index-truth-up branch (`chore/lint-deep-dive-index-truthup`) merges last.

## Recommended Order

(Historical — the plan the drain followed. See Drain Status above for outcomes.)

1. **Owner priority:** 50 step 1 (wire registers into the gate — one small
   commit closes the "wrong-way suppression passes" hole), then 54 (decide
   suppression-proof collection vs restricted-disable fence — inline
   disables currently launder ratchet debt into baseline tightenings), then
   decide the ledger design (50 step 2 + 61 together).
2. **High-severity small fixes:** 30 (one-line-evasion of a security fence),
   20 (heap policy — recorded field OOM), 35 and 33 (S-size rule holes),
   13 (gate-pressure integrity), 70 items 1-2 (stale docs at conflict/adoption
   surfaces).
3. **Rule work in one lane:** 38 first (builds the shared binding-resolution
   helper) → 31 → 32 → 36, then 34. 37 rides at normal priority — its false
   positive was verified latent on 2026-07-04 (client code has no
   member-expression event names yet) but detonates repo-wide the day a
   shared event-constants object is adopted.
4. **Measure, then architecture:** instrument per-slot ESLint wall/CPU first
   (it gates the whole P track), then 21 → 22 → only then decide 23.
   Independent M-size ergonomics in any order: 41, 42, 51, 52, 53, 60, 72;
   40 step 1 (test upgrade) when touching fences next.
5. **Design-gated last:** 23, 71, 70-item-3, 40-step-2 — each records its
   decision in the leaf before the first commit. Parked: 16 (revisit only
   if it bites in practice); trim candidate: 14.

## Promotion Rules

1. Promote exactly one leaf into active work; read
   [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) first.
2. Reconfirm seams with `rg` / `bun run code:intel` before editing.
3. Rule tightenings that surface existing debt start as lint-ratchet entries
   per `docs/guides/lint-ratchet.md` ("Adding a new rule to an already linted
   area"); zero-findings tightenings land directly (30, 33, 35 verified
   zero-findings on 2026-07-04).
4. Preserve envelope/baseline identity semantics byte-for-byte in any
   ratchet-runtime change; the copy-and-run portability fixtures must stay
   green.
5. When a leaf lands, mark its row Done here; durable context goes in the
   commit, not this index.
