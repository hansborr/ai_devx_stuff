# 16. RatchetFamilyScope privately re-declares the exported MaxLinesRatchetPolicy from a module it already imports

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13) — `lint-ratchet-registry-builders.ts:4` is now `type RatchetFamilyScope = MaxLinesRatchetPolicy;`. See the residual note below. The body below is the original finding — its cited line numbers (6 builders + `ParserRatchetFamilyScope`) predate finding 03 and no longer match the file.
Theme: duplication · Area: tooling · Severity: quality-low · Size: XS
Source: drift:ai duplicate-types (drift-baseline; confirmed identical fields and existing import edge) · Confidence: med

## Follow-up — residual naming smell (the dedup target is misnamed for its current consumers)

The alias landed as `type RatchetFamilyScope = MaxLinesRatchetPolicy;`. But the sibling
fix in [03](./03-drift-tooling-dead-exported-functions.md) deleted the max-lines builders
(`localMaxLinesRatchet`, the parser-profile builders, and the `ParserRatchetFamilyScope`
intersection), so the only two surviving builders — `localTypeAssertionBoundaryRatchet`
and `vitestValidExpectRatchet` — are **not** max-lines ratchets, yet both now type their
`scope` parameter on a type whose canonical name is `MaxLinesRatchetPolicy`.

This is the "naming judgment" a prior implementer flagged but (correctly) declined to file
as a separate numbered finding: the shapes are byte-identical, structural typing makes the
alias behaviorally exact, and there is no concrete maintenance cost today — so it does not
clear the bug-or-measurable-quality bar. It is recorded here so the option is not lost when
the backlog is next worked.

Note that this finding's *original* rationale — "a ratchet *family scope* IS a max-lines
ratchet policy entry" — was true only while the file still contained max-lines builders. 03
removed them, so the alias now couples two merely *coincidentally*-identical shapes through
a type whose name implies a domain neither consumer belongs to. If cleaned up later, prefer
one of:

1. **Generalize the canonical type's name.** `{ id, files, ignores, zeroBaselineDisposition }`
   is the shared *scope* shape for every ratchet-family builder, not something
   max-lines-specific. Give it a domain-neutral home/name (e.g. an exported
   `RatchetFamilyScope` in a shared module) and have `max-lines-policy.ts` reference that for
   `MaxLinesRatchetPolicy` and its `ratchets` element type. The alias then reads honestly at
   both consumers.
2. **Re-localize the type** — keep `RatchetFamilyScope` as its own locally-declared
   structural type in `lint-ratchet-registry-builders.ts` (effectively reverting this
   finding). Post-03 the two types are independent concepts that merely share a shape, so a
   one-off redeclaration is arguably more honest than aliasing a misleadingly-named type
   across a module boundary.

Either is a pure type-level change (no runtime behavior): gate with `bun run typecheck` and
the scripts ratchet tests, and re-check any harness fixture that copies
`lint-ratchet-registry-builders.ts` verbatim (the original finding noted
`test-harness-check.sh`). Do **not** widen `MaxLinesRatchetPolicy` to absorb anything
max-lines-specific in the process.

## Problem
`scripts/lint-ratchet/lint-ratchet-registry-builders.ts:9-14` declares a module-private `type RatchetFamilyScope` whose field bag is byte-identical to the already-exported `MaxLinesRatchetPolicy` interface in `scripts/lint-ratchet/max-lines-policy.ts:4-9`:

```ts
// max-lines-policy.ts:4-9 (exported)
export interface MaxLinesRatchetPolicy {
  readonly id: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly zeroBaselineDisposition: LintRatchetZeroBaselineDisposition;
}

// lint-ratchet-registry-builders.ts:9-14 (private dup)
type RatchetFamilyScope = {
  readonly id: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly zeroBaselineDisposition: LintRatchetZeroBaselineDisposition;
};
```

Both reference the same `LintRatchetZeroBaselineDisposition` import from `./zero-baseline-types.js`. The builders file already imports the value `maxLinesPolicy` from `./max-lines-policy.js` (line 6), so the source module is already an edge — only the type import is missing. This is a maintainability liability: the two shapes are semantically coupled (a ratchet "family scope" *is* a max-lines ratchet policy entry), and a future field added to one (e.g. another disposition-style field) silently diverges from the other with no compiler signal. Collapsing the dup removes one of the two declarations the next editor must keep in sync.

## Evidence
- `scripts/lint-ratchet/max-lines-policy.ts:4-9` — exported `MaxLinesRatchetPolicy` interface (the canonical shape).
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:9-14` — byte-identical private `RatchetFamilyScope`.
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:6` — file already imports `maxLinesPolicy` from `./max-lines-policy.js`; the source module is in scope.
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:16-18` — `ParserRatchetFamilyScope = RatchetFamilyScope & { parserProfile }`; the extension would re-base onto the imported type.
- `scripts/lint-ratchet/lint-ratchet-registry-builders.ts:28,45,69,84,99,116` — all six exported builders parametrize on `RatchetFamilyScope`/`ParserRatchetFamilyScope`.
- `scripts/lint-ratchet/lint-ratchet-config.ts:8` — sole importer of these builders; call sites pass structurally-typed object literals, so an alias swap is structurally transparent.

## Proposed fix
1. In `lint-ratchet-registry-builders.ts`, add a type import: `import type { MaxLinesRatchetPolicy } from "./max-lines-policy.js";` (merge with the existing value import on line 6 or keep as a separate `import type`).
2. Replace the private `RatchetFamilyScope` block (lines 9-14) with a one-line alias: `type RatchetFamilyScope = MaxLinesRatchetPolicy;` — preserves the existing local name so the six builder signatures and `ParserRatchetFamilyScope` (line 16) need no further edits. (Optional: inline `MaxLinesRatchetPolicy` everywhere and drop the alias, but the alias keeps the domain-local name `*FamilyScope`, which reads better at the builder call sites.)
3. The now-unused `LintRatchetZeroBaselineDisposition` import (line 7) was used only by the deleted block — drop it if no other reference remains (grep the file first; it is not used elsewhere as of this writing).
4. TDD note: this is a pure type-level refactor with no runtime behavior change, so no new unit test is warranted. Guard it via the existing gates — run `bun run typecheck` (the structural-identity proof) and the scripts ratchet tests (`scripts/lint-ratchet/lint-ratchet-baseline.test.ts`). `test-harness-check.sh:55-56` copies this file verbatim into a fixture, so confirm that harness test still passes.

## Verification / caveats
- False-positive risk is low: the fields are byte-identical including the shared `LintRatchetZeroBaselineDisposition` type, and structural typing makes the alias behaviorally identical at every call site in `lint-ratchet-config.ts`.
- Scope boundary: do not widen `MaxLinesRatchetPolicy` to absorb `parserProfile` — that field belongs only to `ParserRatchetFamilyScope`. Keep the intersection at line 16-18 intact.
- Before deleting the line-7 import, verify with `rg "LintRatchetZeroBaselineDisposition" scripts/lint-ratchet/lint-ratchet-registry-builders.ts` that the deleted block was its only consumer.
- Implementer should double-check the import path: this is ESM-with-`.js`-extension TS; the type import must use `./max-lines-policy.js`, matching the existing value import on line 6.
- A config-suppression is not appropriate here; this is a real two-line code change, not a lint-noise case.
