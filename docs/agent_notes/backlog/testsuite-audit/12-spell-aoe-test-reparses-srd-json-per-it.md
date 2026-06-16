# 12. spell-area-of-effect-overrides.test.ts re-reads and re-parses the 400KB SRD spells JSON once per it()

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: speed · Area: server · Severity: low · Size: XS · Confidence: high
Theme: per-test-redundant-work · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
`spell-area-of-effect-overrides.test.ts` validates that the `SPELL_AREA_OF_EFFECT_OVERRIDES` seed table stays in sync with the SRD spell corpus: one `it()` asserts every AoE-shaped spell description has an override, the other asserts every override points at a real SRD spell id with a valid payload. Both checks need the full parsed corpus, and both get it by calling `loadSpells()` — a helper that does a `readFileSync` + `JSON.parse` of `data/5e-srd-spells-5.2.json` (403,910 bytes / 6,443 lines). Because the call sits inside each `it()` body, the file is read from disk and parsed twice per run.

The runtime cost is genuinely small: the parse benchmarks at roughly 6.5ms, and this file already pays the server suite's global DB-setup tax (`vitest.config.ts` wires both `setupFiles` and `globalSetup`), which dominates its wall time. So the second read is invisible in the noise — this is **not** a real speed win and should not be sold as one.

The value is maintainability. The `loadSpells()` helper reads as if it were free, while actually doing per-test disk I/O and a 6KB-line JSON parse. The shape invites the next contributor to add a third assertion (and a third disk read) without a second thought. Hoisting the load to a single module-scope binding makes the cost obvious-once and removes the foot-gun.

## Evidence
- `packages/server/src/seed/spell-area-of-effect-overrides.test.ts:32` — `function loadSpells(): SpellSeedRow[] { return JSON.parse(readFileSync(SPELL_DATA_PATH, "utf8")) as SpellSeedRow[]; }` — the per-call read+parse helper.
- `packages/server/src/seed/spell-area-of-effect-overrides.test.ts:42` — `loadSpells()` called in the "covers every spell whose description matches the AoE candidate patterns" `it()` (first read).
- `packages/server/src/seed/spell-area-of-effect-overrides.test.ts:51` — `loadSpells()` called again in the "only references real SRD spell ids and valid AoE payloads" `it()` (second read).
- `packages/server/src/seed/data/5e-srd-spells-5.2.json` — 403,910 bytes / 6,443 lines (verified via `ls -l` / `wc -l`); benchmarked `JSON.parse` ~6.5ms.
- `packages/server/vitest.config.ts:18-19` — `setupFiles` + `globalSetup` confirm the global server DB-setup that already dominates this file's wall time, so the duplicated read is negligible against it.

## Proposed direction
Hoist a single `const SPELLS = loadSpells()` at module scope (or memoize behind a lazily-initialized cache) and derive both `candidateIds` and the `spellIds` `Set` from that one binding. The two assertions stay byte-for-byte identical; only the data source changes from "call loadSpells() again" to "read the already-parsed SPELLS". Because the parsed corpus is read-only in both tests — neither mutates a `SpellSeedRow`, both only filter/map/`Set`-construct over it — there is no cross-test isolation or flakiness concern in sharing one frozen-by-convention array.

Estimated impact: saves ~6.5ms (one disk read + parse) — negligible for runtime, and not worth framing as a speed win given the surrounding DB-setup cost. The real payoff is readability: the load happens once, visibly, and the helper no longer looks free-but-per-test. Pure cleanup, zero coverage change — same two `it()` blocks, same assertions, same pass/fail outcomes.

## Scope / caveats
Touch only this one file (`packages/server/src/seed/spell-area-of-effect-overrides.test.ts`). The module-scope hoist is safe precisely because the corpus is read-only across both tests; do not introduce any per-test mutation that would make a shared binding unsafe. This clears the inclusion bar only marginally and on the maintainability axis — include it as a trivial XS cleanup, but do not over-state the speed payoff. Distinct from any inventory-upsert / seed-loop finding (different file, different mechanism): this is solely about the duplicated SRD-spells read in the AoE-overrides test. (This finding folds in a duplicate report of the same per-`it()` re-parse; no separate material was added beyond confirming the single file and helper.)
