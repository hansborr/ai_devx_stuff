# 13. Shard the single baseline JSON into one file per ratchet so concurrent PRs draining different rules never collide

Status: Rejected (won't-do) — design gate closed 2026-07-02; do not implement without new evidence that the semantic merge driver is insufficient.
Lens: ratchet · Area: baseline · Severity: med · Size: M · Confidence: med
Theme: baseline-merge-conflicts · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
All 17 ratchet entries live in one 59,018-byte `lint-ratchet.baseline.json`
(verified 2026-07-02; `tests` keyed by ratchet id). Any two PRs that each move
ANY floor — even for completely different rules in different packages — both
rewrite the same file and meet the merge driver. In the multi-contributor
adopting repo this made baseline conflicts a near-every-merge event. Sharding
to one file per ratchet entry makes the cross-rule conflict class structurally
impossible: two PRs draining different rules touch disjoint files and merge
textually clean with no driver involvement at all.

DESIGN GATE: this leaf is explicitly gated on the outcome of leaf 10. If the semantic min-merge driver lands and proves reliable, it already auto-resolves both the cross-rule case AND the same-rule/different-file case (which sharding alone does not fix — two PRs draining different files of the same rule still collide inside one shard). In that world sharding is redundant complexity and this leaf should be closed as won't-do. Implement only if leaf 10 is rejected, proves fragile in practice, or driverless clones (leaf 11) remain common enough that reducing driver reliance is itself the goal.

## Decision

Rejected as won't-do on 2026-07-02. Leaf 10's semantic min-merge driver landed
in `e8b9f7db` and was hardened in `6a0106df`. The driver passed two independent
adversarial reviews and covers both the cross-rule baseline collisions this
sharding proposal targets and the same-rule/different-file collision class that
sharding alone would not resolve. Given that gate result, sharding would add
baseline layout, migration, orphan-detection, and merge-driver pattern
complexity without a remaining conflict-avoidance payoff.

## Evidence
- `lint-ratchet.baseline.json:1-3` — single document, `{ "version": 1, "tests": { "ratchet/..." : ... } }`; 17 entries matching `lintRatchets` as of 2026-07-02 (`/workspace/scripts/lint-ratchet/lint-ratchet-config.ts:133-489`).
- `/workspace/scripts/lint-ratchet/paths.ts` — `BASELINE_FILENAME` / `baselinePath` single-path constants; consumers include `modes.ts:57-62` (readBaseline), `edit-check.ts:71-73,265-267`, `lint-ratchet-check-registry.ts:168-170`, `lint-ratchet-summary.ts:145-151`. `safeRatchetId` already exists (used for cache paths, `eslint-config.ts:29`) and gives filesystem-safe shard names.
- `/workspace/scripts/lint-ratchet/baseline-format.ts:91-114` + `baseline-validation.ts:165-167` — deterministic key sort and byte-determinism gate already exist; per-shard determinism is the same code applied per entry.
- `/workspace/.gitattributes:11` + `/workspace/scripts/git/install-lint-ratchet-merge-driver.sh:56-78` — attribute patterns and the installer's info/attributes mirror are anchored to the single root path and would need glob forms (`/lint-ratchet/baseline/*.json`).
- Prior art: imbue-ai/ratchets (https://github.com/imbue-ai/ratchets) shards by *directory* (per-directory budget files), which is an alternative axis: it also splits same-rule contention when drains are directory-scoped, at the cost of many more files and a coarser count model (budgets per directory rather than per file).

## Proposed direction
If the gate opens: move to `lint-ratchet/baseline/<safeRatchetId(test-id)>.json`, each shard holding one entry (`{ version, test: {...} }`), deterministic key sort within each. Keep parse/compare/update logic operating on the assembled in-memory `LintRatchetBaseline` — only `paths.ts`, read/write plumbing (`modes.ts`, `baseline-update-apply.ts`), the determinism check (per shard), `.gitattributes` + installer patterns, and the adoption guide's copy list change. Provide a one-shot migration inside `lint:ratchet:update` (detect legacy single file, write shards, delete legacy) so the transition is a single reviewed diff. Consider whether the merge driver mapping is still wanted per shard (same-rule conflicts) or whether shards revert to plain text merges with union-like safety via the symmetric gate.

## Scope / caveats
- Record the leaf-10 gate decision in this file before starting; do not implement both leaf 10's driver and sharding for conflict-avoidance reasons alone.
- Orphan detection (`lint-ratchet-check-registry.ts:124-140`) must learn "shard file exists but registry id doesn't" — a rename now leaves a stale *file*, not just a stale key.
- One commit is possible but tight (plumbing + migration + attributes + guide); if split, land the reader that accepts both layouts first, then the writer/migration.
- The imbue per-directory-budget alternative is a bigger philosophical change (budgets vs per-file floors) — cite it, do not adopt it here.
