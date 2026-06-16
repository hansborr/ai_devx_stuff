# 40. Shared map entity type is named `VttMap`, breaking the `Map*` prefix family and having zero references

Status: Done 2026-06-13 — renamed `VttMap` → `MapEntity` in `packages/shared/src/schemas/map.ts:73` (one-line, zero refs confirmed via `code:intel`, typecheck green). Rename only; not deleted (dead-code belongs to drift-ai).
Theme: naming consistency · Area: shared · Severity: low · Size: XS

Source: codebase maintainability/onboarding audit 2026-06-13 (lens: naming-consistency); evidence independently re-verified. · Confidence: high

## Decision (locked 2026-06-13)
**Rename `VttMap` → `MapEntity`** (not bare `Map`, which would shadow the JS `Map` global in importing modules). Aligns with the `Map*` family; zero references make it an XS one-line rename guarded by `typecheck`.

## Problem
In `packages/shared/src/schemas/map.ts` the base map entity type is exported as `VttMap`, but everything around it in the same file uses the plain `Map` prefix: the schema it derives from is `mapSchema`, and the sibling types are `MapToken`, `MapLayer`, `MapDetail`, and `MapSummary`. So inside one ~135-line file the singular entity is `VttMap` while its own detail variant is `MapDetail` and its summary variant is `MapSummary` — the entity and its composites do not share a name root. The backing Prisma model is also plain `Map` (`schema.prisma:1348`), so the lone `Vtt` prefix matches neither the schema, the model, nor any peer type. For a new developer reading the map domain top-down, `VttMap` reads like a deliberately distinct concept (a "VTT map" vs. some other map) when it is simply *the* map row type; that false signal costs time and invites mis-derivation. It is also the only `Vtt`-prefixed name in the file and has zero references anywhere in the repo, so the rename is mechanically trivial.

## Evidence
- `packages/shared/src/schemas/map.ts:66` — `export type VttMap = z.infer<typeof mapSchema>;` — the only `Vtt`-prefixed name in the file.
- `packages/shared/src/schemas/map.ts:53` — `export const mapSchema = z.object({ ... })`: the schema `VttMap` derives from uses the `map` root, not `vttMap`.
- `packages/shared/src/schemas/map.ts:89,106,117,130` — sibling types `MapToken`, `MapLayer`, `MapDetail`, `MapSummary` all use the plain `Map*` prefix; `MapDetail` (:117) is literally `VttMap`'s own detail variant (`mapDetailSchema = mapSchema.extend(...)`, :112).
- `packages/server/prisma/schema.prisma:1348` — `model Map {` (plain `Map`), confirming the persistence-layer name is `Map`, not `VttMap`.
- `bun run code:intel -- refs packages/shared/src/schemas/map.ts:66:13` → `references VttMap (0 results) — no references found`; a repo-wide `rg -n "VttMap" -g '!**/generated/**'` returns only the declaration line. The type is exported but unconsumed.

## Proposed direction
Rename the exported type `VttMap` → `Map` (or, if a bare `Map` export is undesirable because it shadows the JS `Map` global in importing modules, `MapEntity` — but match whichever root the team prefers and apply it consistently to the family). Shape only, do not implement:
1. `shared` first (package flow `shared -> server -> client`): rename the `export type` at `map.ts:66`. Because `code:intel` confirms zero references, no downstream `server`/`client` edits are required — this is purely a one-line rename of an unused export, which is exactly why it is XS.
2. TDD-aware: there is no behavioral test to add (a `z.infer` type alias has no runtime). The guard is the compiler — `bun run --filter @musi/shared typecheck` (and full `typecheck`) must stay green; a type-only rename of an unreferenced symbol cannot change emitted JS, so existing schema tests for `mapSchema` are sufficient and unchanged.
3. If the team would rather *use* the type than rename-and-leave-unused, note in the leaf that the natural consumer is the map service/router return path, but that is a separate decision — the in-scope action here is the naming fix.
4. No guide mandates this change; cross-reference any map-area `*-MODULE.md` if one exists when implementing, but none is required to land the rename.

## Scope / caveats
- This is a naming-consistency finding, NOT a dead-code finding. The zero-references fact is cited only to show the rename is *cheap and low-risk*; the recommendation is to **rename**, not delete. Dead/unused-code removal is owned by `docs/agent_notes/backlog/drift-ai-findings/` and is explicitly out of scope here — do not convert this into a deletion. (If a future pass deletes the alias instead, that belongs to drift-ai, not to this leaf.)
- Not a duplication finding either; there is no second `VttMap`/`Map` declaration, just one mis-prefixed name.
- Confirmed distinct from existing backlog: no backlog file under `docs/agent_notes/backlog/` mentions `VttMap` or this map-naming concern.
- Do not touch the Prisma `model Map`, `mapSchema`, or the sibling `Map*` types — they are already consistent; only `VttMap` is the outlier. Keep the rename to the single declaration line so it stays XS and review-trivial.
