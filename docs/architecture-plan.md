# Architecture Plan

Stable architecture and the reasoning behind it. For current execution status,
use `docs/agent_notes/in_progress/` for active scope,
`docs/agent_notes/backlog/` for parked scope, and `docs/agent_notes/LOG.md` for
curated recent history.

## Stack

| Layer | Technology | Why |
| ----- | ---------- | --- |
| Monorepo | TypeScript + Bun workspaces | Shared package graph and single-tool workflow |
| Shared contract | Zod schemas in `@musi/shared` | One validation surface for client and server |
| Server | Fastify + tRPC | Typed request layer without REST boilerplate |
| Database | PostgreSQL + Prisma | Relational model with schema-first migrations |
| Realtime | Socket.io + optional Redis adapter | Broadcasts and room coordination after persistence |
| Client | React + TanStack Query + TanStack Router | Strong data fetching, invalidation, and route state |
| UI primitives | shadcn/ui (Radix + Tailwind v4) | Accessible, owned components with theme control |
| Testing | Vitest + Playwright | Fast unit/integration coverage plus E2E |

## Package Layout

- `packages/shared` — schemas, rules, constants, dice logic, shared types.
  Consumers import scoped subpaths, not a root barrel. See
  `docs/adr/0005-shared-subpath-exports.md` (ADR-0005). Shared code depends on
  no app or runtime adapter — see
  `docs/adr/0006-shared-package-layering.md` (ADR-0006).
- `packages/server` — tRPC routers, service layer, Prisma schema/migrations,
  Socket.io entry points.
- `packages/client` — route components, UI, hooks, and state management.

## Core Boundaries

- Shared Zod schemas are the wire contract. Types derive from schemas rather
  than being hand-maintained in parallel. See
  `docs/adr/0004-trpc-shared-schema-boundary.md` (ADR-0004).
- tRPC owns queries and mutations. Socket.io handles auth, room membership,
  presence, and post-persist broadcasts. See `docs/socket-architecture.md` and
  `docs/adr/0003-socket-broadcasts-after-commit.md` (ADR-0003).
- Authorization and visibility rules live behind helpers; do not open-code
  access checks. See `docs/authorization.md` and
  `docs/adr/0002-character-not-found-semantics.md` (ADR-0002).
- Complex server orchestration lives in `packages/server/src/services/`.
  Structural rules for that layer live in `packages/server/src/services/README.md`.
- Race-sensitive writes go through `utils/*-mutations.ts`, not direct Prisma
  updates. See `docs/CONCURRENCY.md` and
  `docs/adr/0001-race-sensitive-writes.md` (ADR-0001).

## Data Model Shape

Schema detail belongs in Prisma; this section only names the stable ownership
boundaries:

- **Auth** — `User`, `Session`.
- **Campaign** — `Campaign`, `CampaignMember`, `CampaignInvite`,
  `ChatMessage`, `CampaignNote`, `Npc`, `Notification`.
- **Character** — `Character` plus focused sub-tables for classes, stats,
  proficiencies, conditions, spell slots, spells, feats, features, and
  level-up choices.
- **Reference data** — seeded SRD tables plus homebrew collections/entries
  that reuse the same shared schemas.
- **Combat / VTT** — `Encounter`, `EncounterParticipant`, `CombatLog`,
  `Map`, `MapToken`, `MapLayer`.

### Terminology

- **VTT** = Virtual Tabletop = the client-side view over the `Encounter` /
  `Map` / `Token` data model above. The abbreviation is client-only (it does
  not appear under `packages/server/src`); the persistence side is named after
  those models. See
  [`packages/client/src/components/vtt/MODULE.md`](../packages/client/src/components/vtt/MODULE.md).

## Level-Up Choice Tracking

`CharacterLevelChoice` records the player-facing choices made at a level
(ASI vs feat, subclass, skills, similar) so recent level-up decisions can be
reviewed and rolled back without full character snapshot versioning.

## Key Architecture Decisions

1. **tRPC over REST** — shared Zod schemas drive typed client/server calls end
   to end.
2. **SRD data lives in the database** — queryable, filterable, and shareable
   alongside homebrew data.
3. **Dice logic lives in `@musi/shared`** — the client and server use the same
   parser and roll semantics.
4. **Combat is a state machine** — encounter lifecycle is explicit rather than
   implicit state spread across booleans.
5. **Character combat state is referenced, not copied** — character
   participants read and write live `CharacterStats`; only monsters and NPCs
   carry inline combat state.
6. **Concentration is its own field** — track
   `CharacterStats.concentrationSpellId`, not a pseudo-condition row.
7. **Homebrew is first-class** — it reuses shared schemas and plugs into the
   same read surfaces as SRD data.
8. **VTT is layered on top of the core app** — it consumes campaign, combat,
   and character state instead of redefining them. See the Terminology entry
   above and
   [`packages/client/src/components/vtt/MODULE.md`](../packages/client/src/components/vtt/MODULE.md).
9. **TanStack Router owns route and search-param state** — navigable UI state
   belongs in the URL.
10. **shadcn/ui is the UI base layer** — Radix primitives plus owned source
    keep the component stack accessible and customizable.
11. **The visual theme is token-driven** — dark fantasy / parchment styling is
    implemented via CSS custom properties. See `docs/design-direction.md`.
12. **`CharacterClass` exists from day one** — multiclassing should not require
    a schema migration later.
13. **2024 SRD rules are the baseline** — background-driven ASIs and related
    rule changes are modeled directly.
14. **Seed from structured SRD exports, not PDF parsing** — keep import flows
    deterministic and reviewable. See `docs/srd-data-sources.md`.
15. **Konva is the current VTT renderer** — the map/token data model stays
    renderer-agnostic so the canvas implementation can change later. For the
    VTT term and shell, see
    [`packages/client/src/components/vtt/MODULE.md`](../packages/client/src/components/vtt/MODULE.md).
16. **Zustand is only for ephemeral client state** — TanStack Query owns
    server state, and URL-addressable state stays in TanStack Router.
