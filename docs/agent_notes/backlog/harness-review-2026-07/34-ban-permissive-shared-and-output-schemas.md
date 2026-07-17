# 34. Ban `z.any()` in shared schemas and permissive tRPC output schemas at lint time

Status: Done — `sharedSchemaZAnyRestrictedSyntax` + `permissiveTrpcOutputRestrictedSyntax` in `package-boundary-configs.js`.
Lens: lint-rules · Area: shared+server · Severity: med-high · Size: S-M · Confidence: med
Theme: schema-permissiveness · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Shared Zod schemas are the cross-package contract; `z.any()` in one disables both
type-checking and wire sanitization for every consumer. The tRPC-procedure guide bans
permissive outputs (`docs/guides/add-trpc-procedure.md:20-21`: avoid `z.any()`, top-level
`z.unknown()`, undefined-accepting schemas), but on the shared-schema side nothing enforces it,
and on the output side enforcement is a test-time gate, not line-local lint — an agent finds
out at `bun run test`, after writing the schema, instead of at edit time.

## Evidence
- COUNT CORRECTION (half a): the audit's "~11 z.any()/z.unknown() uses" splits as **0**
  `z.any()` and **11** `z.unknown()` in `packages/shared/src/schemas` (verified 2026-07-01).
  10 of the 11 are the legitimate `z.record(z.string(), z.unknown())` payload shape
  (`map.ts:110`, `map-inputs.ts:171`, `homebrew-inputs.ts:78,89`, `homebrew-export.ts:47`,
  `homebrew.ts:299`, `encounter-inputs.ts:263`, `encounter.ts:141`, `character.ts:272`,
  `campaign.ts:65`); the 11th is `chat-inputs.ts:65` (`metadata: z.unknown().optional()`).
  So a `z.any()`-only ban has **zero** current findings.
- COVERAGE CORRECTION (half b): permissive tRPC outputs are already gated — 
  `packages/server/src/routers/app-router.output-coverage.test.ts` rejects `z.any()` anywhere
  in the schema tree (nested included, lines 133-147), plus top-level `z.unknown()`/undefined-
  accepting outputs, for every mutation and all enforced queries, with a self-cleaning
  allowlist (lines 155-185). Current `.output(z.any()/z.unknown()/z.void())` count in server
  src: **0** (verified). The gap is lint-time locality plus surfaces outside the app-router
  walk, not missing enforcement.
- Existing lint surface to extend: `local/strict-shared-schemas`
  (`eslint-rules/strict-shared-schemas.js` — strict/passthrough discipline on exported
  `z.object`), `local/trpc-require-output-schema`, `local/trpc-shared-output-schema`
  (`eslint-config/local-plugin.js:40-45`). None of them looks at `z.any()`.

## Proposed direction
One commit, two config-cheap halves, both at zero findings:
(a) ban `z.any()` in `packages/shared/src/schemas/**` (non-test) via `no-restricted-syntax`
selector `CallExpression[callee.object.name='z'][callee.property.name='any']` — allow
`z.unknown()` as the sanctioned "genuinely dynamic payload" spelling (it forces narrowing at
use sites, unlike `z.any()`), message pointing at `z.unknown()` and
`docs/guides/add-trpc-procedure.md`;
(b) mirror the guide's output ban at lint: flag `.output(z.any())`, `.output(z.unknown())`,
`.output(z.void())` in `packages/server/src/routers/**` — either the same restricted-syntax
block or a small extension of `local/trpc-require-output-schema` so the diagnostic lands on
the `.output(` line. Keep the output-coverage test as the deep (nested) gate; lint covers the
shallow shapes agents actually type.

## Scope / caveats
- Both halves verified at zero findings → straight to normal lint per house convention; the
  "ratchet the inventory" note from the audit is moot unless re-verification finds new sites.
- Do NOT ban `z.unknown()` in shared schemas — the 11 current uses are intentional
  record-payload shapes; banning would just generate 11 markers for correct code.
- Half (b) intentionally does not replicate the test's nested-`z.any()` tree walk in lint —
  syntax-level lint can't chase schema consts across files; the test keeps that job.
- Registration/authoring per `docs/guides/local-eslint-rules.md` if the local-rule route is
  chosen for (b); otherwise config test rows only.
