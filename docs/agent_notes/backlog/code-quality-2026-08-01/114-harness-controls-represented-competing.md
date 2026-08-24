# 114. The harness generator and checker keep two same-named raw-control models with duplicated, already-drifting non-lint field walks below the typed manifest parser

Status: Landed on fix/cq-114
Theme: raw-control model duplication · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`harness.controls.json` has a real typed contract — the Zod discriminated union
in `scripts/harness/harness-manifest-schema.ts` — and, contrary to first
appearances, both major consumers already go through it: `harness:check`
strict-parses the whole manifest, and the doc generator re-parses every control
through the loose `categorizedControlFieldsSchema` at its success point. The
seam is documented (`docs/guides/harness-manifest-parser.md` carries a
division-of-labor table and an explicit "when not to migrate" test), and the
generator's direct read is a recorded, rationale-backed exception: it must read
*past* schema-level defects so its one-pass per-control registration report
survives a single typo.

The live problem sits one layer **below** that seam. The generator and the
checker each maintain their own raw-record type — two different interfaces both
named `RawControl`, one with typed optional fields, one all-`unknown` — and
each hand-rolls its own per-kind walk over the shared field predicates:
`pushNonLintFieldFailures` on the generator side, `validateNonLintEntry` on the
checker side. The two walks cover the same checklist (ruleName only on
lint-rule, category, principle, pairedGuide, repairKind/repairCommand, source,
invocation) with near-identical message strings, and nothing ties them
together. They have already drifted: the bare-backlog-coordinate check on
`principle` exists only in the checker, and `source` validation sits inside the
generator's walk but outside the checker's. Every new manifest field or message
must be wired twice, a divergence between generator diagnostics and checker
failures is silent, the generator carries a `json` double-cast to bridge its
raw type, and its own comments name the failure mode ("schema divergence").
For a repo meant as a public harness-engineering reference, two divergent raw
models under one schema teach adopters exactly the wrong pattern.

## Evidence

- `scripts/harness/harness-manifest-schema.ts:81-118` — the canonical
  discriminated-union control contract; the header at `:1-19` records the
  2026-07-19 division-of-labor design ruling.
- `scripts/harness/generate-harness-controls.ts:46-59` — `interface RawControl`
  #1, typed optional fields. `scripts/harness/harness-check-validation.ts:22-35`
  — `interface RawControl` #2, every field `unknown`. Same name, different
  shapes, no relation.
- `scripts/harness/generate-harness-controls.ts:103-130` — the generator's
  hand-rolled throwing envelope parse (`readManifest`), ending in the
  `type-assertion-boundary: json` double-cast at `:126-127`
  (`entry as unknown as RawControl`).
- `scripts/harness/generate-harness-controls-validation.ts:71-102`
  (`pushNonLintFieldFailures`) vs
  `scripts/harness/harness-check-validation.ts:181-206`
  (`validateNonLintEntry`) — the duplicated non-lint field checklist, both
  built over the same predicates imported from `control-field-validation.ts`
  (`generate-harness-controls-validation.ts:5-20`,
  `harness-check-validation.ts:3-18`).
- Confirmed drift #1: `harness-check-validation.ts:174` rejects a bare backlog
  coordinate in `principle` via `findBareBacklogCoordinate`; the generator's
  walk checks only non-emptiness
  (`generate-harness-controls-validation.ts:85-87`).
- Confirmed drift #2: the generator validates `source` inside the shared walk
  (`generate-harness-controls-validation.ts:94-98`); the checker validates it
  up front, before the kind branch
  (`scripts/harness/registration-manifest-checks.ts:123`), and
  `validateNonLintEntry` has no source check at all.
- Both paths already consume the schema: strict whole-manifest parse at
  `registration-manifest-checks.ts:160` (`safeParseHarnessManifest`); loose
  per-control re-parse at `generate-harness-controls-validation.ts:147-153`,
  whose failure branch labels itself "schema divergence" — a defensive branch
  that only exists because the guards and the schema are maintained separately.
- The generator's direct read is sanctioned with an inline rationale:
  `scripts/harness/manifest-contract-check.ts:112-127` (shrink-only
  `MANIFEST_DIRECT_READERS`; the generator entry's comment at `:119-126`
  explains why it must keep reading past schema failures).
- The checker-side raw model fans out: 6 non-test importers of
  `harness-check-validation.ts` under `scripts/harness/`
  (`registration-check.ts`, `registration-manifest-checks.ts`,
  `registration-generated-checks.ts`, `harness-gate-parity.ts`,
  `fixture-closure-check.ts`, `generated-surfaces.ts`), plus the
  `scripts/harness-check.ts` entrypoint (`:28`).
- Stray surface: `harness-check-validation.ts:20` re-exports
  `isNonEmptyString` at top level for no structural reason.

## Proposed direction

Do **not** re-route generation and checking through one strict whole-manifest
parse — that migration already happened (schema + `harness-manifest-loader.ts`
+ the shrink-only `MANIFEST_DIRECT_READERS` tripwire), and the remaining raw
paths are documented sanctioned exceptions. Instead, converge the residual
duplication one layer down. One M-sized change, in order:

1. **Canonical raw record.** Add a `CONTROL_FIELD_NAMES` as-const tuple plus
   one mapped `RawControlRecord` type with all-`unknown` optional fields beside
   `control-field-validation.ts`. `harness-check-validation.ts` adopts it as
   its `RawControl` (a re-export keeps `registration-manifest-checks.ts`
   imports stable). The generator narrows to
   `RawControlRecord & { readonly id: string }` via spread-construction after
   its existing throwing id guards — deleting the `type-assertion-boundary:
   json` double-cast at `generate-harness-controls.ts:127` while keeping the
   sanctioned hand-rolled throwing envelope parse and its exact messages
   ("must be an object", "must declare a controls array", …).
2. **One shared non-throwing, live-tree-free NON-LINT field walker** — e.g.
   `collectNonLintFieldIssues(raw, { repoRoot, principleFromRegistry,
   includeSource, bareCoordinateCheck })` — emitting `{ field, message }`
   issues with byte-identical existing message strings. The `field` tag is
   load-bearing: each caller reorders and filters to reproduce its exact
   smoke-pinned diagnostics (checker keeps source-separate-up-front and the
   bare-coordinate check; generator keeps source-late). Intentional
   divergences become explicit commented walker options instead of silent
   path-local behavior. Do **not** unify the lint-rule paths
   (`resolveLintRuleControl` vs `validateLintRuleEntry`) — they are different
   checks (meta.docs projection vs plugin-registration), not duplicates.
3. **Callers stay thin adapters over their existing sinks.** The generator
   keeps its short-circuit decisions, slots/hookWiring resolution, the
   `categorizedControlFieldsSchema` re-parse, and `ResolvedControl`
   projection; the checker keeps its `pushFailure`/`Map<id, ControlFailures>`
   sink and layers its checker-only live-tree checks (repairCommand and
   invocation script existence, ratchet-registry ids, parity sweeps)
   unchanged.
4. **Untouched:** `harness-manifest-schema.ts`, `harness-manifest-loader.ts`,
   the `harness-manifest.ts` leaf, the `MANIFEST_DIRECT_READERS` tripwire, and
   the fixture copy-closures.
5. **Same-change riders.** Add one division-of-labor row to
   `docs/guides/harness-manifest-parser.md` (table at `:49`) naming the shared
   field-inventory/walker owner; drop the stray `export { isNonEmptyString }`
   at `harness-check-validation.ts:20`.

Acceptance proof: a before/after diagnostics A/B over
`bash scripts/tests/test-generate-harness-controls.sh` and
`bash scripts/tests/test-harness-check.sh`, plus both unit suites
(`bun run test:scripts:file -- scripts/harness/harness-check-validation.test.ts`
and `bun run test:scripts:file -- scripts/harness/control-field-validation.test.ts`,
the latter covering `resolveControl`), showing byte-identical failure output.

## Scope / caveats

- **Binding ruling — no whole-manifest parse-once rewrite.** The original
  "parse once through one strict schema" idea re-litigates a landed,
  test-pinned 2026-07-19 design ruling (schema header at
  `harness-manifest-schema.ts:10`, the `MANIFEST_DIRECT_READERS` rationales,
  and the guide's "when not to migrate" test at
  `docs/guides/harness-manifest-parser.md:119`) and would destroy the
  generator's one-pass granular report. Consolidate one layer down only.
- **Binding ruling — fenced files.** Do not touch `harness-manifest-schema.ts`,
  `harness-manifest-loader.ts`, the `harness-manifest.ts` leaf, the tripwire,
  or fixture copy-closures; do not add a loose envelope schema export for the
  generator. The cast deletion comes from the all-`unknown` record type, not
  from schema changes.
- **Binding ruling — lint-rule paths stay separate.** The walker is scoped to
  the non-lint per-kind checklist only.
- **Binding ruling — walker discipline.** It must emit tagged
  `{ field, message }` issues (never untagged flat strings), own no
  short-circuiting, and perform no live-tree lookups; short-circuit/report
  decisions and all live-tree checks stay caller-side; intentional divergences
  (bare-backlog-coordinate, source placement) are explicit commented options;
  the A/B diagnostics proof above is mandatory.
- **Severity/size revision.** The lane's high/L/needs-split rested on a stale
  "declared schema is not consumed" premise; both consumers already parse
  through the schema. This is one M leaf at low-to-medium severity — the drift
  engine is real, but the guide and the contract-check tripwire already cover
  the discoverability half.
- The typed-parser migration itself landed after the 2026-07-25 pack (commits
  `bf07da818`, `6a5290189`, `b20a081a3`); no prior-pack leaf covers this
  residual sub-schema seam.
- **Cross-references.** Complementary, not blocking:
  [127-public-harness-manifest-has-no-versioned.md](./127-public-harness-manifest-has-no-versioned.md)
  covers the *external* publication of a versioned manifest schema and could
  sequence naturally after this internal consolidation.
  [125-manifest-copies-verify-slot-programs-across.md](./125-manifest-copies-verify-slot-programs-across.md)
  and
  [126-hook-wiring-repeats-adapter-templates-leaves.md](./126-hook-wiring-repeats-adapter-templates-leaves.md)
  edit `harness.controls.json` *content* (slot programs, hook wiring), not the
  parser modules — no ordering dependency, but avoid working them concurrently
  with this leaf in `scripts/harness/`.
