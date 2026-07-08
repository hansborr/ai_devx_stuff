# 61. Knip unused-export floor gates only totals — same-count swaps pass; add identity to the baseline

Status: **Implemented 2026-07-07** via arch-review leaf 12 slice 1 (commit `61d66c6c` on `chore/arch-12-baseline-framework`). The identity ledger (v2 schema, `(category, path, symbol)` keys, derived counts, symmetric same-count-swap gate, count-verified v1→v2 migration) landed on the extracted `scripts/lib/baseline` framework with the knip sensor as first consumer. A semantic merge CLI on the shared `mergeBaseline` is delivered; wiring it into `.git/info/attributes` is a tracked follow-up (see leaf 12 "Slice 1 outcome"). Original design retained below for reference.
Cross-ref (2026-07-07): `../arch-review-2026-07/12-baseline-framework-and-max-lines.md` proposes migrating this sensor onto an extracted ratchet update/gate layer — coordinate if both run; implementing this identity design on that framework is the natural combined slice.
Sequencing ruling (Fable consult, 2026-07-07): do NOT implement standalone — the design is framework-shaped (the ratchet's item model with a richer key), and a standalone build duplicates item-level compare/format/update and forfeits the semantic merge driver on a new ~282-entry file. Implementation is re-filed as slice 1 of arch-review leaf 12 (framework extraction + this sensor as first consumer), queued behind the agent-cli consolidation pack. The identity-ledger *design* below still awaits the owner's explicit approval.
Lens: inventory · Area: knip floor · Severity: med · Size: M · Confidence: high
Theme: inventory-honesty · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The committed baseline (`sensor-knip-unused-exports.baseline.json`) stores
exactly five numbers: total count (282) and four per-category counts — no
file, no symbol. Removing one unused export while adding a different one is
invisible; drain progress and regression can cancel silently; and broad
`ignoreIssues` entries in `knip.config.ts` further reduce what the floor
sees. Contrast with the lint ratchet next door, whose per-file items +
fingerprints are what make its floor meaningful — the two committed floors
embody different rigor for the same idea.

## Evidence
- `sensor-knip-unused-exports.baseline.json:1-13` — counts only (read 2026-07-04).
- `scripts/sensor-knip-unused-exports-baseline.ts:57-110` — comparison logic over totals/categories. Verified.
- `knip.config.ts:18-41` — ignore surface.

## Proposed direction
Store identities: `{ file, symbol, category }` list (sorted, deterministic),
gate on *new identities* (fail) and *disappeared identities* (require
baseline tightening, mirroring the ratchet's symmetric improvement rule).
Keep the count summary for the trend view. Reuse the ratchet's
baseline-format conventions (sorted keys, stable serialization, update
command) so the two floors converge on one mental model — and note in the
adoption guide that this is the same pattern at tier-0.

## Shared identity-ledger design (owner-review draft, no implementation yet)

Reuse the same ledger contract as leaf 50 step 2: deterministic JSON, a
human-readable summary derived from identities, and an `entries[]` list keyed
by stable identity fields rather than by aggregate counts. For knip, this is a
baseline schema v2 for `sensor-knip-unused-exports.baseline.json`; the current
v1 baseline remains count-only until implementation lands.

Proposed v2 shape:

```json
{
  "version": 2,
  "tool": "knip",
  "metric": "unused-export-symbols",
  "includeCategories": "exports,types,enumMembers,namespaceMembers",
  "summary": {
    "count": 282,
    "categories": {
      "exports": 148,
      "types": 134,
      "enumMembers": 0,
      "namespaceMembers": 0
    }
  },
  "entries": [
    {
      "key": "exports|packages/server/src/example.ts|unusedSymbol",
      "path": "packages/server/src/example.ts",
      "category": "exports",
      "symbol": "unusedSymbol"
    }
  ]
}
```

Identity keying:
- Key as `(category, path, symbol)`, serialized as
  `category|path|symbol` after path normalization to repo-relative POSIX
  paths. This is intentionally independent of line numbers and knip output
  order.
- Sort `entries[]` lexicographically by `key`; derive `summary.count` and
  `summary.categories` from `entries[]` during formatting so counts cannot
  drift from identities.
- Renames are expected identity churn: old `(path, symbol)` disappears and new
  `(path, symbol)` appears. The update command must make intentional churn
  cheap, but the gate should still force review of same-count swaps.

Gate semantics:
- Current identities absent from the baseline are blocking regressions, even
  when the total count is unchanged.
- Baseline identities absent from current output are blocking improvements
  until the baseline is tightened, matching the lint-ratchet symmetric floor.
- Category totals stay in the output for trend/readability, but they are not
  the enforcement primitive once v2 exists.

Migration plan:
- First implementation run should collect the current knip unused-export
  symbol identities and verify their derived counts exactly match the v1
  baseline (`count: 282`, `exports: 148`, `types: 134`,
  `enumMembers: 0`, `namespaceMembers: 0`). If they do not match, stop and
  handle the count drift as a separate baseline update before writing v2.
- The v1-to-v2 commit should be a pure schema migration: same visible debt,
  same categories, plus identities. No `ignoreIssues` changes in the same
  commit.
- Keep `knip.config.ts` `ignoreIssues` explicit. The identity baseline records
  what knip reports after those ignores; it does not replace or hide the ignore
  surface.
- Prefer shared parser/formatter conventions with the suppression ledger and
  lint-ratchet baselines, but do not introduce a broad abstraction until both
  ledgers need the same helper code.

## Scope / caveats
- Knip identity churn on renames is noisier than per-file counts; the update
  command must make legitimate churn one-command cheap
  (`sensor:knip-unused-exports --update` presumably exists — verify its
  semantics first).
- Coordinate the identity-ledger design with leaf 50 step 2 (suppression
  ledger) — one pattern, three floors (ratchet, knip, suppressions).
- One commit: baseline schema v2 + migration + gate change + tests.
