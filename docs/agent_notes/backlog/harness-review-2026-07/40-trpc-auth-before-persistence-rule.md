# 40. Rule prototype: router procedures must call an auth helper or sanctioned service boundary before touching Prisma

Status: Rejected (measured noise) — prototype gate executed 2026-07-02; do not ratchet without a lower-noise design.
Lens: lint-rules · Area: server · Severity: med-high · Size: M-L · Confidence: low
Theme: auth-order-enforcement · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
The authorization model (`docs/authorization.md`) hangs on discipline: every campaign/character
procedure calls the right `assert*` helper before reading or writing, preserving the
intentional `NOT_FOUND`-mismatch semantics (authorization.md:10-11). Nothing lints the
ordering. An agent adding a procedure that queries Prisma first and auth-checks after (or
never) produces an IDOR-shaped bug that unit tests written by the same agent won't catch.
This was Codex's P0 proposal in the second-opinion review; it is the highest-value and
highest-false-positive-risk rule in the pack, hence design-gated.

## Decision

Rejected on 2026-07-02 after measuring the conservative AST prototype against
all 29 non-test router files in `packages/server/src/routers/`.

Prototype shape tested: within `.query(...)` / `.mutation(...)` callbacks,
report direct `ctx.prisma.*` / `prisma.*` calls before the first recognized
boundary. The seed boundary list was the six campaign/character helpers named
below. A second pass added the plausible sanctioned helper boundaries visible in
the routers (`assertEncounterDm`, `assertCollectionReadAccess`, `assertAuthor`,
and `loadNoteForMutation`). The prototype had focused RuleTester coverage while
measuring, but was not landed as an active ESLint rule after this gate rejected
enforcement. The measurement-only artifact is archived under
`docs/agent_notes/backlog/harness-review-2026-07/40-trpc-auth-before-persistence-measurement/`;
its README records the exact reproduction commands.

Measured results:

| Prototype pass | Findings | True positives | False positives | Verdict |
| --- | ---: | ---: | ---: | --- |
| Seed six auth helpers only | 91 | 0 | 91 | too broad for posture decision |
| Seed helpers + sanctioned router boundaries | 67 | 0 | 67 | reject |
| Same as above plus explicit allowlist for known public/user-scoped/resource-lookup procedures | 0 | 0 | 0 | proves the required allowlist would encode the current router inventory rather than a useful general rule |

The 24 seed-only findings removed by the sanctioned-boundary pass were all
false positives: `encounter-map.ts` (`27`, `33`, `40`, `57`, `66`, `75`, `97`,
`101`, `128`) and `encounter.ts` (`134`, `154`, `198`, `230`, `236`) came after
`assertEncounterDm`; `homebrew.ts` (`211`, `230`, `253`, `297`, `348`, `359`,
`376`, `397`) came after `assertAuthor` or `assertCollectionReadAccess`;
`note.ts` (`225`, `243`) came after `loadNoteForMutation`.

The remaining 67 findings from the sanctioned-boundary pass classified as:

| Class | Findings | Classification |
| --- | ---: | --- |
| Auth/session/account lifecycle in `auth.ts` (`113`, `128`, `146`, `200`, `223`, `224`, `225`, `256`, `270`, `281`, `292`, `297`, `311`, `322`, `334`) | 15 | False positive: these procedures are public credential/session flows or protected `ctx.user.id` account operations, not campaign/character auth boundaries. |
| Public content reads in `magic-item.ts` (`105`, `124`, `142`), `monster.ts` (`157`, `182`, `198`), and `srd.ts` (`430`, `434`, `445`, `449`, `453`, `496`, `501`, `506`, `511`, `516`, `524`, `529`, `534`, `539`) | 20 | False positive: these are intentionally public SRD/content queries. |
| User-scoped or self-owned flows in `campaign.ts` (`127`, `150`, `159`, `172`), `character.ts` (`58`, `96`, `113`), `homebrew.ts` (`138`, `191`), `invite.ts` (`144`, `197`), and `notification.ts` (`32`, `37`, `58`, `70`, `85`) | 16 | False positive: these filter or write by `ctx.user.id`, create rows owned by the actor, or use an invite token as the authorization credential. |
| Parent/author lookup before the auth decision in `encounter.ts` (`82`, `259`), `homebrew.ts` (`154`, `203`, `223`, `238`, `268`, `286`, `308`, `369`, `384`), `inventory.ts` (`109`), `invite.ts` (`122`), `map.ts` (`51`), and `npc.ts` (`150`, `177`) | 16 | False positive: the router must read the row first to discover the campaign, character, owner, or author id needed for the existing `NOT_FOUND`-preserving auth check. |

The measured signal:noise ratio is `0:67`, far worse than the leaf's roughly
`5:1` promotion threshold. A ratchet entry would baseline only false positives,
and an advisory/report-only sensor would teach agents to chase intentional
router patterns. Leave this rejected unless a future design can distinguish
campaign/character IDOR risk from public reads, `ctx.user.id` filters, and
parent-row lookups without a broad procedure allowlist.

## Evidence
- Auth helper inventory verified (the allowlist seed):
  `packages/server/src/utils/campaign-auth.ts` — `fetchCampaignMembership` (:19),
  `assertCampaignMember` (:38), `assertCampaignDm` (:71);
  `packages/server/src/utils/character-auth.ts` — `assertCharacterOwner` (:16),
  `assertCharacterAccess` (:66), `assertCharacterOwnerOrAccess` (:142).
- Surface size: 29 non-test router files in `packages/server/src/routers/`; 132
  `protectedProcedure` + 26 `publicProcedure` references in `.ts` router files
  as of 2026-07-02. Only 16 of the 29 router files call
  the six auth helpers directly — the rest delegate to services (which auth internally),
  are user-scoped (`auth`, `notification`, filtering by `ctx.user.id`), or are SRD/public
  reads. That spread is exactly why naive "auth call before prisma call" flags legitimately
  auth-free and service-delegating procedures.
- `docs/guides/add-trpc-procedure.md` codifies the helper expectation for new procedures;
  AGENTS.md Working Model says auth changes must preserve the NOT_FOUND semantics.
- Precedent for order-sensitive AST rules in-house: `eslint-rules/no-broadcast-in-transaction.js`
  (position-within-callback tracking); authoring contract in
  `docs/guides/local-eslint-rules.md`.

## Proposed direction
Do NOT commit to enforcement yet. Gate sequence:
1. Build a conservative AST prototype: within a procedure handler
   (`.query(...)`/`.mutation(...)` callback), report `ctx.prisma.*` / `prisma.*` member calls
   that occur before the first call to an allowlisted boundary — the six auth helpers, plus a
   curated sanctioned-service list (service functions that take `ctx` and auth internally),
   plus explicit user-scoped patterns (`where: { userId: ctx.user.id }`-style is NOT
   detectable reliably; those procedures go on a file/procedure allowlist instead).
2. Measure against all 29 routers; classify every finding true/false. Expected outcome per the
   16/29 spread: a meaningful false-positive tail from service-delegating and legitimately
   public procedures.
3. Decide from data: <~5:1 noise → land as a lint-ratchet entry over the accepted findings
   (`docs/guides/lint-ratchet.md`, "Adding a new rule to an already linted area"); worse →
   land as advisory-only (agent envelope `warn` per the severity semantics in
   `docs/guides/local-eslint-rules.md`) or record a rejection verdict with the measured
   numbers.
Escape hatch either way: parseable marker (`// auth-before-persistence: <reason>`) for
intentionally public/pre-auth reads, same mechanism as `type-assertion-boundary`.

## Scope / caveats
- DESIGN GATE: medium false-positive risk is the central open question; the sanctioned-service
  allowlist is the hard part and will need maintenance — an allowlist that rots turns the rule
  into noise. Budget the prototype-and-measure step before any registration work.
- "Touches Prisma" must include transitive service calls to be sound; v1 explicitly does not
  chase call graphs (lint is file-local) — the rule is a tripwire for the blatant in-router
  case, not a proof of authorization. Say so in the rule's `principle`.
- Must not push code toward violating the NOT_FOUND-mismatch convention — the message should
  name the helpers, not suggest inline membership checks.
- Prototype can live under `docs/agent_notes/` + a scratch script; only the post-gate rule +
  tests + registration (+ ratchet entry if chosen) becomes the one small commit.
