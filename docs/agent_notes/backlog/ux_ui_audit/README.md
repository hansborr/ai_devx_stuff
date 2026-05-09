# UX/UI Audit — 2026-04-14

End-to-end audit of the Musi VTT from the perspective of DMs, players, and design/engineering practitioners.

> Note for current readers: the dated findings under `findings/` reference
> `CLAUDE.md` because that was the canonical agent doc on 2026-04-14.
> `CLAUDE.md` is now a thin wrapper around `AGENTS.md`; treat any
> `CLAUDE.md` pointer in the findings as "see `AGENTS.md` (and its Claude-
> only addendum in `CLAUDE.md`)". Findings are not rewritten — they are
> dated artifacts of the audit.

## Environment

- Client: http://localhost:8000
- Server: http://localhost:8001 (tRPC at `/trpc`)
- Both already running in the devcontainer.

## Seeded accounts (password `password123`)

| Email | Display name | Role in audit |
|---|---|---|
| `dm@example.com` | Dungeon Master | DM persona |
| `player1@example.com` | Aragorn | Player persona |
| `player2@example.com` | Gandalf | Second player (invite flow) |

No seeded campaigns or characters — audit flows must create them.

## Routes under audit

`/` (index), `/login`, `/register`, `/dashboard`, `/campaigns`, `/campaigns/$id`, `/join`, `/characters/create`, `/characters/$id`, `/homebrew`, `/homebrew/collections/$id`, `/magic-items`, `/settings`.

## Reporting template

Every auditor writes to `findings/<role>.md` using this shape:

```markdown
# <Role> audit — <date>

## What went well
- ...

## What went wrong
- <concrete issue>, repro: <how to reproduce>, impact: <who it hurts>

## Areas for improvement
- ...

## Suggestions
- ...

## Open questions for the backend dev
- ...
```

Screenshots go in `screenshots/` named `<role>-<slug>.png`. Reference them inline.

## DM scenarios (minimum coverage)

1. Register or log in as DM; land on dashboard.
2. Create a new campaign; edit its description/settings.
3. Invite players via the invite flow; copy the link.
4. Add NPCs and monsters from SRD; author a homebrew monster.
5. Create an encounter, add SRD monsters + an NPC, start combat.
6. Roll initiative; advance rounds; apply damage/conditions; end combat.
7. Create/author a homebrew collection (spell or monster or magic item) and attach it to the campaign.
8. Review DM-only notes on NPCs; confirm player visibility rules feel correct.

## Player scenarios (minimum coverage)

1. Accept invite (or `/join` flow) as player1.
2. Create a PC via the character creation wizard — pick a class, subclass, background, species, ability scores.
3. Open the character sheet; inspect attacks, spells, skills, equipment, features.
4. Take a short/long rest; spend and recover resources; apply a condition.
5. Join the DM's encounter; experience the combat UI from player POV.
6. Browse magic items / homebrew as a player (what can I even see?).

## Cross-cutting lenses

- **First-impression / empty states** — what does a new user see when nothing exists?
- **Error states** — submit invalid data, disconnect from socket, stale token, unauthorized access.
- **Loading states** — cold load, slow network (Playwright can throttle), reload mid-action.
- **Mobile / narrow viewport** — 375px width.
- **Accessibility** — keyboard nav, focus visibility, color contrast, screen-reader landmarks.
- **Information scent** — can the user guess what each button does before clicking?
- **Consistency with `docs/design-direction.md`** — dark fantasy/parchment, shadcn/ui, typography.

## Phase order (so agents don't stomp on each other)

1. **DM auditor** drives Playwright first. Writes `findings/dm-perspective.md`.
2. **Player auditor** drives Playwright second. Writes `findings/player-perspective.md`.
3. **UX expert**, **UI dev**, **backend dev** run in parallel on Phase 1 findings + code review.
4. **Synthesis** produces `SUMMARY.md` with an aggregated top-10 issues list.
