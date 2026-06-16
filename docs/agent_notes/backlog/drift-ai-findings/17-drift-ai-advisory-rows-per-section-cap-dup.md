# 17. rows-per-section PrototypeCap builder duplicated across coverage-evidence / env-branches / test-orphaning advisories

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-low · Size: S
Source: drift:ai near-duplicates-2 (drift-baseline; confirmed all three sites on re-inspection) · Confidence: med

## Problem
Three drift:ai advisory lenses each hand-roll an identical per-section `PrototypeCap` builder that counts how many sections were truncated (`totalCandidates > entries.length`). The bodies differ only in the cap label and two display nouns; the structure — the `.filter(...).length` count, the `hit: hitCount > 0`, and the `${hitCount} ${plural(noun, hitCount)} had more than ${top} ...` detail string — is otherwise copy-pasted:

- `test-orphaning-advisory.ts` `rowsPerSectionCap`: label `"rows per section"`, detail `... ${plural("section", hitCount)} had more than ${top} candidate rows`.
- `env-branches-advisory.ts` `rowCap`: byte-identical to the above (same label, same `"section"` noun, same `candidate rows` suffix).
- `coverage-evidence-advisory.ts` `rowCap`: label `"rows per artifact"`, noun `"artifact"`, suffix `parsed rows`.

The shared scaffolding this would slot into already exists — `PrototypeCap`, `PrototypeSection<TRow>` and `appendPrototypeSection` in `prototype-advisory.ts`, and `plural()` in `advisory-format-helpers.ts` — so this per-section cap is the last copy-pasted piece. Consolidating it removes ~10 duplicated lines x3, gives one place to fix the truncation-disclosure wording, and prevents the two `"section"` copies from silently drifting apart. (Note: env-branches and test-orphaning are currently exact duplicates; coverage-evidence diverges only in label/noun/suffix.)

This is a low-severity maintainability/dedup win, not a bug — the three caps behave correctly today.

## Evidence
- `scripts/drift-ai/test-orphaning-advisory.ts:135-148` — `rowsPerSectionCap(top, sections)`; sections-based count, noun `"section"` (verified).
- `scripts/drift-ai/env-branches-advisory.ts:231-244` — `rowCap(top, sections)`; identical body to the above (verified; this is the third site the audit only partly confirmed).
- `scripts/drift-ai/coverage-evidence-advisory.ts:233-246` — `rowCap(top, sections)`; same shape, noun `"artifact"`, label `"rows per artifact"`, suffix `parsed rows` (verified).
- `scripts/drift-ai/prototype-advisory.ts:50-55` — shared `PrototypeCap` type; `appendPrototypeSection` at `prototype-advisory.ts:149`.
- `scripts/drift-ai/advisory-format-helpers.ts:21` — shared `plural(word, count)` (note: lives here, NOT in `prototype-advisory.ts` as the audit spec stated).
- DISTINCT, do NOT merge: `scripts/drift-ai/class-construction-advisory.ts:202-210` and `scripts/drift-ai/coverage-unused-correlation-advisory.ts:111` — `rowCap(top, total)` is a total-count shape (`hit = total > top`, label `"candidate rows"`), not per-section.

## Proposed fix
1. Add a shared helper to `scripts/drift-ai/prototype-advisory.ts`, e.g.
   `export function rowsPerSectionCap(top: number, sections: readonly PrototypeSection<unknown>[], opts: { label: string; noun: string; rowNoun?: string }): PrototypeCap` — count `sections.filter((s) => s.totalCandidates > s.entries.length).length`, then build the `PrototypeCap` with `opts.label`, `plural(opts.noun, hitCount)`, and a `rowNoun` defaulting to `"candidate rows"` (coverage-evidence passes `"parsed rows"`). Import `plural` from `./advisory-format-helpers.js`. The `sections` param must accept each lens's section type — type it against the `PrototypeSection` fields it reads (`totalCandidates`, `entries.length`); make all three lens section types structurally satisfy `PrototypeSection<TRow>` if they do not already, or widen the param to `readonly { totalCandidates: number; entries: readonly unknown[] }[]`.
2. Replace the three local builders with calls: test-orphaning and env-branches pass `{ label: "rows per section", noun: "section" }`; coverage-evidence passes `{ label: "rows per artifact", noun: "artifact", rowNoun: "parsed rows" }`. Delete the three local functions.
3. TDD: the existing assertions already pin the observable output — `env-branches-advisory.test.ts:146-159` (`label: "rows per section"`, `cap rows per section: HIT -- PARTIAL run`), `coverage-evidence-advisory.test.ts:60` (`cap rows per artifact: within limit 20`), and `test-orphaning-advisory.test.ts:291-292`. Keep all three green unchanged. Add a focused unit test for the new helper in a `prototype-advisory.test.ts` covering: zero hits (`hit: false`, `detail: null`), one hit (singular noun), multiple hits (plural noun), and the `rowNoun` override. Run with `bun run test:scripts:file -- scripts/drift-ai/prototype-advisory.test.ts`.

## Verification / caveats
- False-positive risk is med per the audit; on re-inspection the three sites are real and the env-branches copy (the one the audit only partly confirmed) is byte-identical to test-orphaning, so the dedup is sound.
- Scope boundary: do NOT fold in the `rowCap(top, total)` builders in `class-construction-advisory.ts` and `coverage-unused-correlation-advisory.ts` — they are a genuinely different (total-count, `"candidate rows"` label) shape and merging them would force an awkward two-mode helper.
- Double-check the section types actually expose `totalCandidates` and `entries` with compatible variance before widening the helper param; prefer constraining to `PrototypeSection<TRow>` over an `unknown[]` widening if the lens types already conform, to avoid loosening type safety at the call sites.
- The output strings (`cap` label, `plural` noun, row noun) are asserted verbatim in the three `.test.ts` files — preserve them exactly so the consolidation is behavior-preserving.
- This is backlog prep only; nothing here is implemented yet.
