# 28. The map-input schema suite buries the one field under test inside dozens of repeated full-payload literals

Status: Not started
Theme: typed test payload builders · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/schemas/map-inputs.test.ts` is a comprehensive 895-line
boundary suite for thirteen map/token/layer input schemas, and nearly every one
of its 102 `it(...)` cases spells out a complete payload literal by hand. The
create-map cases repeat `campaignId` + `name` + the field being probed; the
create-token cases repeat `mapId`, `label`, and a `x: 0, y: 0` coordinate pair
around whichever field the case is actually about. The literal mass is large
enough to measure: `mapId` appears 79 times (55 of them as the identical
`mapId: "m1"`), `x: 0` and `y: 0` 23 times each, `campaignId: "c1"` 15 times,
`name: "Map"` 11 times.

That costs contributors twice. When a map or token input schema gains or renames
a required field, the change fans out into dozens of near-identical payload
edits across the file instead of one base. And when reading any single case, the
signal — the one field whose boundary is being exercised — is buried inside a
five-to-seven-line payload that is 80% identical to its neighbours; a reviewer
must diff whole literals to find it. The base IDs are not even consistent
(`camp1` vs `c1`, `map1` vs `m1` between success and rejection cases), so the
repetition cannot be grepped as one pattern either. The sibling `map.test.ts`
already solved this shape for the entity schemas with file-local
`validMap`/`validToken`/`validLayer` builders; the input suite never adopted the
idiom.

## Evidence

- `packages/shared/src/schemas/map-inputs.test.ts` — 895 lines, 102 `it(...)`
  cases (both re-measured at the pin). `mapId` occurs 79 times, `mapId: "m1"`
  55 times, `x: 0` and `y: 0` 23 times each, `campaignId: "c1"` 15 times,
  `name: "Map"` 11 times.
- `packages/shared/src/schemas/map-inputs.test.ts:120-217` — nine consecutive
  create-map boundary cases each repeat the full `{ campaignId: "c1", name:
  "Map", ... }` payload; e.g. the `width` min/max pair at `:120-138` differs
  from the `gridSize` pair at `:151-169` only in the one probed field.
- `packages/shared/src/schemas/map-inputs.test.ts:425-574` — the create-token
  family repeats a second, larger literal: every rejection case from `:425` on
  re-states `mapId`/`label`/`x: 0`/`y: 0` around the field under test (empty
  label `:436-445`, oversize label `:447-456`, negative coordinate `:458-467`,
  size 0 `:481-491`, bad color `:493-503`, ...).
- Inconsistent base IDs within one describe: create-map success cases use
  `campaignId: "camp1"` (`:57`, `:70`, `:85`) while its rejection cases use
  `campaignId: "c1"` (`:96` onward); token success cases use `mapId: "map1"`
  (`:358`, `:374`) while rejections use `mapId: "m1"` (`:439` onward).
- The precedent the file never adopted: `packages/shared/src/schemas/map.test.ts:29-91`
  defines file-local `validMap`/`validToken`/`validLayer`/`validSummary`
  builders (`(overrides = {}) => ({ ...base, ...overrides })`), so each of its
  cases states only the delta.
- The typing idiom already in the tree: `packages/shared/src/test/parse-helpers.ts:27-33`
  — `expectSchemaParseSuccess` takes `NoInfer<z.input<TSchema>>`, so typed
  builder output flows through the existing success helper with no casts.
- The labeled-table idiom already in the tree:
  `packages/shared/src/schemas/homebrew.test.ts:1113-1155` — the
  `requiredFieldCase` rows name the schema under test and feed one `it.each`.

## Proposed direction

Add file-local typed payload builders at the top of
`packages/shared/src/schemas/map-inputs.test.ts` — `validCreateMap(overrides?:
Partial<z.input<typeof createMapInputSchema>>)` and `validCreateToken(...)` —
each returning the minimal required-field base spread with overrides. This
mirrors the untyped `validMap`/`validToken` precedent in the sibling
`map.test.ts:29-91`, but typed via `z.input` exactly as
`parse-helpers.ts`'s `expectSchemaParseSuccess` already does. Builder typing is
`Partial<z.input<typeof schema>>` for overrides and `z.input<typeof schema>`
for the return — no type assertions anywhere, keeping the repo's no-cast
standard.

- **Rejection cases** pass an inline spread straight to `schema.safeParse`
  (`{ ...validCreateToken(), x: -1 }`); `safeParse` accepts `unknown`, so
  type-invalid probe values (`"triangular"`, `"red"`) need no assertion escape
  hatch. **Valid cases** go through `expectSchemaParseSuccess` with builder
  output.
- **Keep bases minimal** — required fields only — so the existing
  defaults-pinning tests (`:55-66` for create-map, `:356-371` for create-token)
  still exercise real defaulting rather than fields the base filled in.
- **Canonicalize the base IDs** (`m1` vs `map1`, `c1` vs `camp1`) in one pass,
  updating the assertions bound to those literals — e.g. `:222-224`, `:578-581`,
  `:683-693` assert the exact ID strings — in the same commit as the builder
  adoption for that describe.
- **Convert the symmetric min/max boundary runs** — width/height/gridSize for
  create/update map, token width/height, layer zIndex — into labeled `it.each`
  tables in the style of `homebrew.test.ts:1113-1155`'s `requiredFieldCase`
  table, where each row names the field, the boundary value, and accept/reject.
- **Proportionality is part of the target shape.** For the small-payload
  families (update/move/delete token, layer CRUD) where literals are 2-4
  fields, introduce at most shared `const` reference stubs (e.g.
  `{ id: "t1", mapId: "m1" }`) rather than forcing builders.
- Explicitly out of scope: any change to `map-inputs.ts` or `map.ts` schemas or
  their exports, retyping `map.test.ts`'s own builders, and any new shared or
  exported factory module — everything stays file-local, matching the prior
  pack's ruling that a package-level test API with one caller is a mistake
  (`code-quality-2026-07-25/40-PLAN.md`, Rejected alternatives).
- Verification: run the focused suite via
  `bun run test -- packages/shared/src/schemas/map-inputs.test.ts` and confirm
  the test count matches pre-change (102 cases today), or document intentional
  table consolidations. This file sits in shared; no new config files, so
  mutation-config registration is unaffected.

## Scope / caveats

- **Do not hollow out the defaults-pinning tests.** A base that includes
  optional fields silently converts `:55-66` and `:356-371` from "schema
  defaults these" into "the builder supplied these". Minimal required-field
  bases are a hard constraint, not a style preference.
- **Deliberate mutation-kill cases must survive with their comments intact**:
  the hex-color `^`/`$` anchor pins at `:505-527` (and the update-token twin at
  `:666-673`), and the `MAX_LAYER_DATA_BYTES` exact-boundary pair at
  `:831-845` — preserve those two exact-length tests and their `n + 11`
  serialization comment verbatim.
- **The `imageUrlOrUploadPathSchema` describe (`:35-52`) takes bare strings,
  not payloads — leave it untouched.**
- **Table rows must stay diagnosable.** Each `it.each` row names the field and
  the boundary so a red run identifies the case without decoding a payload;
  vague row labels erode failure diagnostics and are worse than the literals
  they replace.
- **Keep the diff verifiably behavior-preserving.** This is a near-total
  rewrite of an 895-line green suite; keep test names and count stable (or list
  deliberate consolidations in the commit body) so review can confirm no
  boundary was dropped.
- Out of scope (restated from the direction): schema/production changes of any
  kind, `map.test.ts`, and any exported factory surface.
- **Prior pack**: the live 2026-07-25 pack already accepted this exact idiom
  for homebrew monster payloads —
  `code-quality-2026-07-25/40-test-payload-factories.md` via `40-PLAN.md`
  slice 40.2 (`buildMonsterPayload`, file-local to `homebrew.test.ts`; not yet
  landed at the pin — no `buildMonsterPayload` exists in the tree). That slice
  is file-disjoint from this leaf, so there is no hard ordering dependency.
  Soft edge only: if slice 40.2 lands first, mirror its
  `buildXPayload(overrides)` naming/signature convention instead of inventing a
  parallel one; if it has not landed, use the `validX(overrides)` convention
  already present in `map.test.ts` and leave a note for slice 40.2's author
  about converging the two.
- Independent of every other leaf in this pack — no sequencing edges.
