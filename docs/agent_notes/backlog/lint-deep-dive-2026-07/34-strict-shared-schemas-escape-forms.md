# 34. Permissive-schema guards hard-code `z.` and inline `export const` — alias imports, separate exports, and computed calls escape

Status: Done — implemented on fix/lint-alias-binding-lane. Re-verified file:line before acting.
Lens: local rules · Area: schema strictness · Severity: med · Size: M · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
Three related escapes around the shared-schema strictness family (partly
landed as harness-review-2026-07 leaf 34):
1. `local/strict-shared-schemas` requires `callee.object.name === "z"`, so
   `import { z as zod } from "zod"` exempts an entire file from the guard.
2. The rule fires only on `ExportNamedDeclaration` with an inline
   `VariableDeclaration`; declaring the schema as a plain `const` and adding a
   separate `export { FooInputSchema }` escapes.
3. The `no-restricted-syntax` permissive-schema selectors match
   `callee.property.name` only, so `z["unknown"]()` (computed) escapes — the
   same selector-shape gap as the raw-SQL fence (leaf 30).

## Evidence
- `eslint-rules/strict-shared-schemas.js:35-36,73-74` — `z`-identifier hard-coding in both `findZObjectCall` and `analyzeChain`. Verified 2026-07-04.
- `eslint-rules/strict-shared-schemas.js:135-137` — inline-export-only trigger; separate export lists have no `.declaration`. Verified.
- `eslint-config/package-boundary-configs.js:18-19,24-26` — `property.name`-based `any/unknown/void` selectors; computed form unmatched. Verified.

## Proposed direction
- Escape 1 — plan of record (2026-07-04 review): ban the alias outright with
  a tiny import guard (zod must be imported as `z`); the one-liner makes the
  escape moot and keeps both rule helpers simple. Binding resolution stays
  the fallback only if a legitimate aliasing need ever appears.
- Buffer schema-shaped `const` declarations per file and report at
  `ExportNamedDeclaration` specifier resolution (or simpler: also analyze any
  `const <X>Schema = <zodExpr>` at module scope in shared schema dirs,
  exported or not — non-exported permissive schemas in `packages/shared`
  schemas are just as contract-relevant).
- Add computed-property variants to the config selectors (do together with
  leaf 30's sweep so all `no-restricted-syntax` fences get the same
  treatment).

## Scope / caveats
- The alias ban was promoted from "consider first" to plan of record in the
  2026-07-04 review; drop the binding-resolution work for escape 1 unless
  the ban proves untenable.
- One commit for the config selectors; one for the rule changes + tests.
