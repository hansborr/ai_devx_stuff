# 249. Keep CharacterTab on the inferred campaign output contract

Status: Not started
Theme: Keep CharacterTab on the inferred campaign output contract · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`CharacterTab` receives the generated `campaign.get` output type through
`useQuery`, then replaces it with an asserted handwritten projection containing
only campaign members and two character fields. That duplicate shape can lag
behind the server output schema, so a transport change may stop producing the
client-side type error that should identify this query consumer.

The assertion buys no isolation from server detail: all subsequent filtering
and option construction already depend directly on the projected members. It
instead weakens the query boundary while adding another campaign-output shape
for maintainers to recognize and keep current.

## Evidence

- `packages/client/src/components/campaign/encounters/add-participant-dialog.tsx:148-155`
  — `CharacterTab` obtains inferred data from
  `trpc.campaign.get.queryOptions(...)`, then asserts it to a handwritten
  `members` projection before reading the array.
- `packages/client/src/components/campaign/encounters/add-participant-dialog.tsx:157-169`
  — existing-participant exclusion, null-character filtering, and
  `AvailableCharacter` projection all consume the asserted `members` value.
- `packages/server/src/routers/campaign.ts:145-168` — `campaign.get` declares
  `campaignDetailSchema` as its output and returns `mapCampaignDetail(campaign)`,
  giving the client query an inferred published contract.
- `packages/server/src/routers/campaign.ts:63-81` — the canonical member mapper
  includes nullable character details with `id` and `name`, the two fields the
  dialog projects into character options.
- `packages/client/src/components/campaign/encounters/add-participant-dialog.test.tsx:143-154`
  — the focused dialog suite already pins rendering an available campaign
  character and forwarding its id and name through `onAddCharacter`.

## Proposed direction

Delete the asserted `campaign` projection and derive the working array directly
from the query result:

`const members = campaignQuery.data?.members ?? [];`

Leave the existing participant-id set, nullable-character predicate, and
`AvailableCharacter` mapping on that inferred value. If a named projection is
still useful for readability, derive it from the inferred
`campaignQuery.data` output type; do not declare another handwritten campaign
interface or assert the query result into one.

Keep the focused dialog characterization for character rendering and
`onAddCharacter` forwarding. Add cases for excluding an already-participating
character and ignoring a member whose character is null if those branches are
not otherwise pinned, so removing the assertion remains a type-boundary change
without altering option behavior. The client typecheck should demonstrate that
the member predicate and projection compile against the generated query output.

## Scope / caveats

- Preserve the current existing-participant filtering, null-character handling,
  option ordering, and `{ id, name }` projection.
- Do not introduce a second handwritten campaign output interface, whether
  local to `CharacterTab` or exported for reuse.
- This leaf changes only the local client type boundary. It does not alter
  `campaignDetailSchema`, the campaign router mapper, query fetching behavior,
  or participant-add mutations.
- No prior-pack record or current-pack leaf covers this local assertion.
