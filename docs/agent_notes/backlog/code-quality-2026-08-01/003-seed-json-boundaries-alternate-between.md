# 3. Seed JSON boundaries alternate between Zod schemas and unchecked assertion chains because no directory-level rule says what a seed-data boundary guarantees

Status: Not started
Theme: seed validation boundary policy · Area: server · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The shared seed-data loader `readSeedJson` deliberately returns `unknown` and
delegates narrowing to every caller — and every caller has answered
differently. Of the nine production modules in `packages/server/src/seed/` that
consume seed JSON, three parse the corpus through a Zod schema and six rely on
type assertions, ranging from a generic `as T[]` helper to a corpus-wide
`JSON.parse(raw) as MonsterJson[]` to a nested
`as unknown as SpellcastingJson` double assertion. There are also two load
paths: four modules go through `readSeedJson` (vendored SRD reference files
under `data/reference/`), while five read generated corpora under `data/`
directly with `readFileSync`.

Nothing in the directory says which combination is correct. A contributor
adding a new corpus must reverse-engineer the policy from whichever neighbor
they happen to open, and a reader debugging a bad seed cannot predict where
malformed input will surface: at a Zod parse, at a mapping function, at a
nested assertion deep in a helper, or only when Prisma rejects the upsert.
The monsters module shows the concrete cost of narrowing more than once: the
corpus is asserted at load, but because `MonsterJson.spellcasting` is typed as
`Record<string, unknown> | null`, the same data is re-asserted downstream — a
double assertion in one function and four per-field casts in another — three
narrowing sites for one shape.

Notably, every assertion site carries a sanctioned
`type-assertion-boundary: json` marker, and one (reference-tables) documents a
reasoned argument for *not* validating: pinned, shape-stable vendored data on
operator-driven runs fails more legibly at the Prisma upsert. So this is not a
lint problem or a "missing validation" problem — it is a missing, written
policy that would turn nine ad-hoc choices into two declared levels.

## Evidence

- `packages/server/src/seed/seed-data-loader.ts:27-49` — `readSeedJson`
  returns `unknown` via an explicit `JSON.parse(raw) as unknown` (`:49`, json
  marker at `:48`); narrowing policy is delegated to every caller.
- Nine non-test modules in `packages/server/src/seed/` consume seed JSON
  (grep for `readSeedJson|JSON.parse`, excluding the loader itself; count
  re-verified at the pin). Three schema-parse, six assert.
- The three schema-parsers:
  `seed-srd-backgrounds.ts:118-119` (`backgroundsJsonSchema.parse` over
  `readSeedJson`), `seed-srd-equipment.ts:266-268`
  (`equipmentsJsonSchema.parse` over `readSeedJson`), and
  `seed-srd-magic-items.ts:56-58` (`magicItemsSeedSchema.parse` over a direct
  `readFileSync` + `JSON.parse`).
- The six asserters: `seed-srd-reference-tables.ts:47-50` — generic
  `loadJson<T>` returning `readSeedJson(...) as T[]`, whose marker at `:48`
  explicitly says "No runtime validation here — bad input fails downstream
  Prisma upsert with a clearer error than a Zod check at the load boundary
  would surface, and seed runs are operator-driven"; `seed-srd.ts` — five
  corpora asserted (`as SkillJson[]` `:89`, `as TraitJson[]` `:119`,
  `as SpeciesJson[]` `:188`, `as SubspeciesJson[]` `:190`, `as FeatJson[]`
  `:206`); `seed-srd-spells.ts:95` — `JSON.parse(raw) as ParsedSpell[]`;
  `seed-srd-monsters.ts:201` — `JSON.parse(raw) as MonsterJson[]`;
  `backfill-srd-monster-actions.ts:31` — `as MonsterCorpusRow[]`;
  `backfill-srd-spell-combat.ts:24` — `as ParsedSpell[]`.
- The narrow-more-than-once case: `seed-srd-monsters.ts:53` types
  `MonsterJson.spellcasting` as `Record<string, unknown> | null`, so after the
  load-boundary assert at `:201` the same data is re-narrowed twice more —
  `m.spellcasting as unknown as SpellcastingJson` at `:183`, and four
  per-field casts (`sc.ability as string`, `sc.dc as number`, …) at `:80-83`
  inside `extractSpellcastingScalars` (marker at `:78`). `SpellcastingJson`
  already exists at `:133`.
- Two load paths, unexplained in-tree: `readSeedJson` +
  `SRD_REFERENCE_DATA_DIR` is imported by exactly four modules (backgrounds,
  equipment, reference-tables, seed-srd), while spells (`:21`, `:93`),
  monsters (`:14`, `:199`), magic-items (`:56-57`), and both backfills
  (`backfill-srd-monster-actions.ts:13`, `backfill-srd-spell-combat.ts:14`)
  `readFileSync` generated corpora under `data/` directly. The loader's
  error message (`seed-data-loader.ts:34-44`) is specific to restoring
  *vendored reference* files, so the split is principled — but nowhere stated.
- A consumed-fields validation pattern already exists in-tree:
  `seed-srd-spells.test.ts:44-52` parses the vendored spell corpus with a
  partial Zod schema (`index` + `classes` only) to pin the closed class
  vocabulary.
- `packages/server/src/seed/` has no `MODULE.md` (verified: no module doc in
  the directory listing at the pin), so there is no place the policy could
  currently live.

## Proposed direction

Land as one small-to-medium change (a panel ruling collapsed the original
split-per-corpus plan — see caveats): the durable fix is a declared policy
plus the two mechanical cleanups that make it true, not a blanket Zod
conversion.

1. **Create `packages/server/src/seed/MODULE.md`** per
   `docs/guides/add-module-doc.md`, declaring the directory policy:
   - **Two corpus classes**: vendored `data/reference/` JSON loads via
     `readSeedJson` (its ENOENT message is reference-restore-specific by
     design); generated `data/` JSON is read directly.
   - **Two validation levels**: *schema-parse* (Zod schema at the load call,
     types derived via `z.infer`) or *assert-with-marker* (sanctioned for
     pinned vendored/generated data — promote the reasoned rationale already
     written at `seed-srd-reference-tables.ts:48` into the level definition).
   - **The narrow-once invariant**: narrowing happens exactly once, at the
     load call site, with a `type-assertion-boundary` marker; downstream
     re-assertions are banned.
   - **Locality rule**: corpus schemas and inferred types stay local to
     `packages/server/src/seed/` — they model vendored external SRD shapes,
     not app contracts, so they never move to `packages/shared` despite the
     shared-schemas convention.
   - **A per-corpus table** stating each file's *current* level, so today's
     mixed state becomes declared policy immediately and any later conversion
     is a one-row doc diff. Record the drift backstop as a MODULE.md gotcha
     ("new corpus ⇒ add a table row + level") — no new lint/generator
     machinery.

   This is the directory's first MODULE.md: follow the guide's registration
   steps, including `bun run module:index` to regenerate `MODULE-INDEX.md`.
2. **Add a schema-accepting overload to the loader**:
   `readSeedJson(baseDir, filename, schema)` returning `z.infer<S>`, wrapping
   `ZodError` in the same actionable, file-naming message style as the
   existing ENOENT branch (`seed-data-loader.ts:34-44`). The 2-arg
   `unknown`-returning form remains for declared assert-level corpora.
   Backgrounds (`seed-srd-backgrounds.ts:118-119`) and equipment
   (`seed-srd-equipment.ts:266-268`) adopt the overload as one-line changes.
3. **Fix the sole narrow-twice violation**: type `MonsterJson.spellcasting`
   (`seed-srd-monsters.ts:53`) as `SpellcastingJson | null` so the single
   load-boundary assert at `:201` covers it; delete the
   `as unknown as SpellcastingJson` double assertion at `:183` **and** the
   per-field casts in `extractSpellcastingScalars` (`:80-83`, marker `:78`),
   which share the same root cause.
4. **Make the policy grep-discoverable**: update the assert-level markers to
   cite the MODULE.md level name, so any call site leads a reader back to the
   directory rule.

## Scope / caveats

- **Binding rulings** (do not relitigate during implementation):
  - Do **not** convert the six assert-level corpora to Zod as part of this
    leaf. Declare assert-with-marker as a documented validation level with the
    per-corpus table; per-corpus conversions are individually-deprioritizable
    follow-up leaves, never blocking.
  - Do **not** reroute the direct-read corpora (seed-srd-spells,
    seed-srd-monsters, seed-srd-magic-items) through `readSeedJson`. Document
    the two corpus classes instead — the loader's ENOENT message is
    reference-restore-specific by design.
  - Do **not** treat this as a needs-split L: land one S/M change (loader
    overload + MODULE.md policy/table + the monsters spellcasting typing fix).
    The L size in the header reflects the original assessment; the panel
    collapsed the scheduled per-corpus tail into optional follow-ups.
  - Do **not** add generator/seeder round-trip schemas, a mandatory
    corpus-parses-clean test suite, or any lint/manifest/generator machinery
    for validation levels (generated-corpus rewrites are parked per the prior
    pack's CQ25-171/172). The marker-cites-policy breadcrumb is the only
    enforcement surface.
  - Do **not** move seed corpus schemas or inferred types into
    `packages/shared` — they stay local to `packages/server/src/seed/`.
- The reference-tables rationale (`seed-srd-reference-tables.ts:48`) is a
  recorded per-site decision, not drift — the MODULE.md promotes it into the
  assert-with-marker level definition rather than overriding it. A reasoned
  opt-out is itself exemplary policy content.
- A corpus-parses-clean test already exists for spells
  (`seed-srd-spells.test.ts:44-52`); extend that pattern opportunistically
  only, never as a required deliverable here.
- Prior-pack overlap: the 2026-07-25 pack's seed-pipeline leaf addressed
  provenance/generators/table-driving, not validation policy, and CQ25-171
  parked the adjacent seed steps (table-driving the eight reference-table
  seeders, `seed-srd-*` renames) that live in this same directory — this leaf
  must not re-file them or fold them in.
- [009-all-four-seed-generators-can-overwrite.md](./009-all-four-seed-generators-can-overwrite.md)
  edits the generators in the same directory whose outputs the MODULE.md will
  classify as generated corpora. No ordering dependency, but avoid working the
  two concurrently in `packages/server/src/seed/`.
- Coordinate with
  [097-two-database-writing-srd-backfill-commands.md](./097-two-database-writing-srd-backfill-commands.md):
  decide its keep-vs-remove branch before finalizing this leaf's corpus table
  and assertion-marker updates. If it removes the backfills, omit both backfill
  rows and marker edits; if it retains them, the validation-policy work remains
  independent.
