# 24. Seed parser error/edge branches untested — parseSpellBlock malformed-input throw and glossary Attitude tag mapping

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: defect-catching · Area: server · Severity: low · Size: S · Confidence: high
Theme: seed-pipeline-coverage · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
Two seed-time parsers have live branches whose failure mode is silent data degradation, and neither branch is exercised by a test.

(1) `parseSpellBlock` throws `No type line found for spell: <name>` when no line in a spell block matches `TYPE_LINE_RE`. Every case in `parse-spell-block.test.ts` feeds a well-formed `*Level N School (Classes)*` italic type line, so this throw is never driven. That would be merely a coverage gap if the throw failed loudly — but the generator (`generate-srd-spells.ts`) wraps each `parseSpellBlock` call in a `try/catch` that pushes the error onto a `warnings[]` array and continues. So a malformed real-world block does not abort the run; the spell is *silently dropped* from the generated output. If a future regex relaxation (e.g. loosening `TYPE_LINE_RE` to be more permissive, or moving the type-line detection) accidentally turned a hard "missing type line" into a mis-parse, no test would notice. Pinning the throw turns the parser's "I cannot understand this block" contract into something a regression test can hold.

(2) `parse-glossary-entry.ts` maps five trailing header tags to categories via `TAG_TO_CATEGORY`: `Action`, `Area of Effect`, `Attitude`, `Condition`, `Hazard`, with every unmapped tag falling back to `general`. The test suite covers four of the five mapped tags (`Condition`, `Area of Effect`, `Hazard`, `Action`) plus the `Unknown` → `general` fallback, but never parses an `[Attitude]` entry. Because the fallback is `general`, an `[Attitude]` entry whose mapping was dropped or mistyped in `TAG_TO_CATEGORY` would not throw — it would silently degrade to `category: "general"`, and the suite would stay green. Real glossary data does include Attitude-tagged entries (Friendly / Indifferent / Hostile), so this is a live mapping, not a hypothetical one.

(3) The merge-added `seed-srd.test.ts` "preserves the original cause" test is misnamed and asserts the wrong branch. It forces an `EISDIR` failure — the *non*-`ENOENT` path in `readSeedJson` that re-throws the raw error and attaches **no** cause — yet claims to verify cause preservation and only asserts `toBeInstanceOf(Error)`, never reading `error.cause`. The actual `ENOENT` cause-wrapping branch (which *does* attach a cause) and the malformed-`JSON.parse` branch are both untested. So the loader's error contract is nominally covered by a green test that exercises the wrong branch — the same silent-degradation, wrong-assertion shape as the two parser gaps above, in the same seed pipeline.

These gaps are cheap to close with pure-node, DB-free test additions that pin one parser/loader branch each.

## Evidence
- `packages/server/src/seed/spell-parser/parse-spell-block.ts:112` — `if (!typeLine) throw new Error(\`No type line found for spell: ${name}\`);`. The sibling `parse-spell-block.test.ts` has zero `toThrow`/error assertions (every case feeds a valid `*…*` type line; the only `throw`/`error` substring hits in that file are inside spell-description fixtures about "saving throw", not assertions).
- `packages/server/src/seed/generate-srd-spells.ts:34-40` — the generation loop is `try { spells.push(parseSpellBlock(block)); } catch (err) { … warnings.push(\`Failed to parse: …\`); }`, so a `parseSpellBlock` throw equals a silently skipped spell at generation time rather than a hard failure.
- `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts:15` — `Attitude: "attitude"` sits in `TAG_TO_CATEGORY` (lines 12-18) alongside the four tested tags; unmapped tags fall back to `general`.
- `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.test.ts:34-102` — cases cover `[Condition]`, `[Area of Effect]`, `[Hazard]`, `[Action]`, and `[Unknown]` → `general` (the fallback case at lines 97-102); `rg -ni attitude` over the file returns zero occurrences, confirming the Attitude mapping is never parsed.

## Proposed direction
Touch only the two test files; add one branch-pinning case each (coverage strictly increases).

1. `parse-spell-block.test.ts`: add a case feeding a block with a header line but no italic type line, asserting `expect(() => parseSpellBlock(block)).toThrow(/No type line/)`. Optionally assert the message includes the spell name (it is the only triage signal the warning surfaces in `generate-srd-spells.ts`).

2. `parse-glossary-entry.test.ts`: add a case parsing `"#### Friendly [Attitude]"` and asserting `result.category === "attitude"`. The better shape is an `it.each` over all five `TAG_TO_CATEGORY` entries `([["Attack [Action]", "action"], …])` so that adding a sixth tag to the map without a test fails loudly — this future-proofs the mapping rather than pinning one new row.

Both additions are pure-node, run under the existing server unit project with no DB, and add no measurable runtime (each is a single synchronous function call). Estimated impact on suite time: negligible (sub-millisecond per case); the value is regression protection, not speed.

## Scope / caveats
- Touch only `parse-spell-block.test.ts` and `parse-glossary-entry.test.ts`. No source changes.
- Do NOT also assert the second `parseSpellBlock` throw at `parse-spell-block.ts:114` (`Type line regex failed for spell: …`). `TYPE_LINE_RE` (defined at `parse-spell-block.ts:33`) carries no `g`/`y` flag, so `.exec()` on the same trimmed string that just passed `.test()` cannot return `null`; that branch is unreachable through `parseSpellBlock` and asserting it would require constructing an impossible state. Pin only the reachable `No type line` throw.
- Prefer the `it.each` form for the glossary tags so all five mappings (and future additions) are covered, not just Attitude.
- Both parsers are seed-time dev tooling (one-time SRD generation, glossary category metadata), not runtime product code, so severity stays low.
- The "Attitude entries exist in the real corpus" claim could not be re-verified against a checked-in markdown source (the SRD glossary input is not in the tree at the audited paths), so it is stated from domain knowledge (Friendly/Indifferent/Hostile), not a file citation; the finding holds regardless because the mapping branch is live and untested.
- This finding was merged from two pass-1 findings (the `parseSpellBlock` error-path gap and the glossary Attitude-mapping gap); they share the `seed-pipeline-coverage` theme and the same fix shape. It is distinct from the `splitIntoBlocks` seed finding (different function/file).
