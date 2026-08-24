# 127. The 2,859-line public harness manifest has no machine-readable published schema — its contract exists only in internal TypeScript

Status: Landed on fix/cq-127
Theme: published manifest schema · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`harness.controls.json` is the repository's central public-reference artifact:
2,859 lines, 179 controls across 12 kinds, with eight distinct control-key
signatures and four root keys. It is exactly the file an external adopter of
this harness would copy or generate tooling against — and it ships with no
`$schema` pointer, no published schema file, and no format-version signal of
any kind. The root object opens directly with project data.

The contract does exist, but only as internal TypeScript: the Zod parser in
`scripts/harness/harness-manifest-schema.ts` owns root keys, per-kind strict
field inventories, and primitive typing, while deep facet shapes live in three
further hand validators per a documented division-of-labor ruling. An external
user who wants to validate a manifest, get editor completion, or detect that
the format changed between two pins must read and reverse-engineer that module
graph. Internal contributors are fine — they have the parser and `harness:check`
— so this is not an internal tax; it is a gap aimed precisely at the audience
the repo exists to serve. And because nothing machine-readable is published,
the heterogeneous control records can change shape without any externally
visible compatibility signal beyond a raw JSON diff.

## Evidence

- `harness.controls.json:1-37` — the root object begins directly with
  `$comment`, `scriptParityExemptions`, `ciGateControlIds`, `controls`; no
  `$schema` URI or version field appears there or anywhere in the file's 2,859
  lines (re-measured: 179 controls, 12 kinds, 8 distinct control-key
  signatures, 4 root keys).
- No JSON Schema emission exists anywhere: no `toJSONSchema`/`json-schema`
  reference in `scripts/` or `package.json`, no `schemas/` directory at the
  repo root, no generic JSON Schema validator (e.g. `ajv`) among dependencies.
- `scripts/harness/harness-manifest-schema.ts:120-139` — the root contract
  `harnessManifestSchema` is a non-exported `const`; only the parse wrappers
  (`:178`, `:189`) and derived types leave the module, so even TypeScript
  consumers outside this repo cannot reach the shape directly.
- `scripts/harness/harness-manifest-schema.ts:10-19` — the header's 2026-07-19
  division-of-labor ruling: the Zod parser owns top-level fields, strict
  per-kind field inventories, primitive typing, and control-id uniqueness;
  deep facet parsing stays with `generated-surfaces.ts` (`generatedSurface`),
  `hook-wiring-schema.ts` (`hookWiring`), `skill-inventory-schema.ts`
  (`skillWiring`), and `verify-step-schema.ts` (slot vocabulary).
- `scripts/harness/harness-manifest-schema.ts:1-8` — the schema module is
  deliberately layered above the dependency-free leaf reader
  `harness-manifest.ts`, which is copied verbatim into reduced fixture trees (a
  fixture-copy-closure boundary any schema-publication change must not cross).
- `scripts/harness/harness-manifest-schema.ts:26-28` — `nonBlankString` is a
  `.refine`, and `:127-139` a `superRefine` duplicate-id check: both are
  invisible to JSON Schema emission as written, so a naive export would be
  silently lossy.
- `package.json:213` — `zod` is `^4.4.3`, so native `z.toJSONSchema` emission
  is available with zero new production dependencies.
- `docs/guides/harness-manifest-parser.md` (143 lines) — the only current
  route to the contract, and it is prose for in-repo contributors ("Import the
  loader"), not something external tooling can consume.
- `scripts/harness/harness-manifest-schema.test.ts:165-171` — the
  every-kind-parses parity pin ties the schema's discriminated union to the
  shared `KINDS` vocabulary; it is the natural anchor for keeping an emitted
  schema fresh when a kind is added.
- `scripts/harness/harness-gate-parity.ts:107-108` — root-key consumers exist
  outside the Zod parser (`parseManifestStringSet` over
  `scriptParityExemptions`/`ciGateControlIds`), so widening the strict root has
  a real, enumerable ripple.

## Proposed direction

Emit the public JSON Schema FROM the existing Zod contract — Zod stays the
single source of truth, and the schema file is a generated projection
registered through the repo's existing generated-surface machinery.

1. **Export the root schema and add one emitter.** Export
   `harnessManifestSchema` from `scripts/harness/harness-manifest-schema.ts`
   and add one doc-generator-style script
   (`scripts/harness/generate-manifest-json-schema.ts`) that writes
   `z.toJSONSchema` output to `schemas/harness.controls.schema.json` with
   deterministic stable-key serialization. The emitter imports ONLY the Zod
   schema module — never `harness.controls.json` and never the dependency-free
   leaf `harness-manifest.ts` — so the fixture-copy-closure boundary and the
   `MANIFEST_DIRECT_READERS` seam are untouched.
2. **Register it as a control.** One new `kind: "doc-generator"` control with a
   `generatedSurface` facet (triggerPaths:
   `generate-manifest-json-schema.ts` + `harness-manifest-schema.ts` +
   `control-field-validation.ts`; outputPaths: the emitted schema) plus
   `bun run verify:steps` regen, inheriting freshness and `harness:check`
   enforcement for free.
3. **Point the manifest at its schema.** Add a root
   `"$schema": "./schemas/harness.controls.schema.json"` key to
   `harness.controls.json` and accept it in the Zod root as
   `$schema: z.literal("./schemas/harness.controls.schema.json").optional()` —
   pinned so a stale pointer fails parse, optional so fixture manifest copies
   still parse. Land both edits in one commit, and sweep
   `scripts/harness-check.ts`, `scripts/harness/harness-gate-parity.ts`, and
   `scripts/harness/registration-manifest-checks.ts` for hardcoded root-key
   inventories.
4. **No formatVersion, no migration/bump policy.** The freshness-gated schema
   file's git diff is the compatibility signal for pin-based copiers; a
   versioned `$id` inside the generated schema is the additive later path if an
   explicit version is ever wanted.
5. **Make the schema self-documenting.** Port load-bearing header comments into
   `.meta({description})` on union arms, facet carriers, and `slotsCarrier`.
   The root description states the strictness boundary: root keys, per-kind
   strict field inventories, primitive types, and `slots` `minItems: 1` are
   contractual; `generatedSurface`/`hookWiring`/`skillWiring` interiors and the
   slot vocabulary are intentionally loose per the 2026-07-19 division-of-labor
   ruling; duplicate-id, repairCommand-iff-codemod, and other semantic checks
   are parser-owned.
6. **Restate `nonBlankString` representably** — `z.string().regex(/\S/)`,
   behavior-identical — so it survives emission instead of vanishing.
7. **Durability.** One round-trip test validating the assembled manifest
   returned by `readHarnessManifest` against the emitted schema via a generic
   validator (`ajv` devDep). At the pin this is equivalent to validating the
   live `harness.controls.json`; once leaf 178's ownership seam exists, the
   assembled value must include its generated lint-rule-controls include. Also
   extend the existing every-kind-parses parity pin
   (`harness-manifest-schema.test.ts:165-171`) so a new kind arm regenerates the
   schema or fails.
8. **Docs.** One short "External schema" section appended to
   `docs/guides/harness-manifest-parser.md`; no new guide.

## Scope / caveats

Binding rulings (each was contested and settled during audit review):

- **Do not invert derivation to schema-first** or make the in-repo parser
  consume a schema-derived model; the Zod contract in
  `harness-manifest-schema.ts` stays the single source of truth and the JSON
  Schema is emitted from it via native `z.toJSONSchema`.
- **Do not publish full-depth strictness or unify the three non-Zod facet
  validators** (`generated-surfaces.ts`, `hook-wiring-schema.ts`,
  `skill-inventory-schema.ts`) into the published schema; publish strictness
  only at the levels the Zod contract owns, and state that boundary in the
  schema's root description. The 2026-07-19 division-of-labor ruling stands.
- **Do not add a `formatVersion` field or any migration/bump policy** to
  `harness.controls.json`; a hand-bumped integer with unenforceable bump
  semantics rots, and it would also force edits to every fixture manifest copy.
- **Do not let the emitter read `harness.controls.json` or import
  `harness-manifest.ts`**; it imports only the Zod schema module.
- **Do not ship the emitter without deterministic stable-key serialization AND
  the ajv round-trip test.** Without the former the freshness check flaps;
  without the latter a `z.toJSONSchema` fidelity gap ships silently and
  external consumers hit it first.
- **Do not leave refinements silently lossy**: restate `nonBlankString` as a
  regex, and list parser-only semantic checks (control-id uniqueness,
  repairCommand-iff-codemod, slot vocabulary) in the schema description as
  repo-side.
- **Do not add the `$schema` root key as a free string**; pin it as the
  optional literal, land the Zod change and the manifest edit in the same
  commit, and do the root-key-consumer sweep named in direction step 3.

Other scope notes:

- Complementary, not overlapping:
  [114-harness-controls-represented-competing.md](./114-harness-controls-represented-competing.md)
  addresses competing *internal* TypeScript models of the same manifest, while
  this leaf is *external* schema publication. No hard ordering edge, but both
  edit `harness-manifest-schema.ts`'s orbit — sequence them rather than working
  them concurrently, and if 114 lands first, re-check which module exports the
  root schema before starting step 1.
- The live 2026-07-25 pack has no leaf or ruling on manifest schema
  publication or versioning; this is new ground, not a re-litigation.
- New-file and generated-surface registration must follow the existing
  single-sourced flow (`generatedSurface` facet + `verify:steps` regen); do not
  hand-wire freshness checks.
- Serialize with
  [178-local-lint-rules-lack-one-canonical.md](./178-local-lint-rules-lack-one-canonical.md):
  both change `harness.controls.json`, `package.json`, registration checks, and
  generated-surface freshness. If 178 lands first, this leaf must publish and
  round-trip the assembled manifest contract, including the generated
  lint-rule-controls include, rather than treating the authored root fragment
  as complete; if this leaf lands first, 178 must preserve the `$schema`
  pointer and schema freshness while introducing include ownership.
