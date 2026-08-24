# 184. Client control flow is coupled to human-readable server error prose

Status: Not started
Theme: typed error contracts · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three client flows treat server-authored English messages as an undocumented wire protocol. Invite handling searches for four case-sensitive words, character loading compares an exact sentence, and account deletion uses one exact comparison plus one substring match. Changing capitalization or improving server copy can therefore replace specific recovery guidance with a generic error without producing a type error.

Generic tRPC codes are insufficient for these branches: multiple invite failures intentionally share `CONFLICT`, while account-deletion reasons use broader transport codes. Contributors must discover which prose is load-bearing by searching both packages, and the existing tests largely preserve the coupling by asserting those messages instead of a stable domain discriminator.

The error formatter already owns the safe server-to-client error shape. A typed reason-code field belongs there; human-readable messages should remain presentation-only.

The socket rate-limit flow has the same defect within the server boundary. Its
middleware creates an ordinary `Error` with one English sentence, and a later
handler recognizes throttling by comparing that sentence exactly before
choosing the emitted protocol code. Editing or wrapping the message can
therefore turn a genuine throttle into `INTERNAL_ERROR` without changing any
type.

## Evidence

- `packages/client/src/lib/invite-errors.ts:1-6` — `mapJoinError` classifies failures with four case-sensitive substring checks: `"expired"`, `"already"`, `"Invalid"`, and `"full"`.
- `packages/client/src/components/campaign/members/join-campaign-dialog.tsx:107-110` and `packages/client/src/pages/join-page.tsx:84-103` — both invite entry points pass server messages into `mapJoinError`; the join page also manufactures the literal `"Invalid invite code"` locally for a missing code.
- `packages/server/src/services/invite-service.ts:32-39`, `:70-71`, `:87-88`, and `:114-128` — invalid, expired, already-member, and full-invite failures are distinguished by independently authored messages; both already-member and full-invite failures use `CONFLICT`.
- `packages/client/src/pages/character-sheet-page.tsx:51-56` — the full-page error distinguishes a missing character through exact equality with `"Character not found"`.
- `packages/server/src/routers/character.ts:47-64` — `character.get` emits the same `NOT_FOUND` message for a nonexistent character and for a private character owned by someone else, preserving existence masking.
- `packages/client/src/pages/settings-page.tsx:268-280` — account deletion compares exactly with `"Password is incorrect"` and searches for `"Transfer or delete campaigns"` before choosing recovery copy.
- `packages/server/src/routers/auth.ts:301-326` — the corresponding server paths use `UNAUTHORIZED` and `BAD_REQUEST`; their messages are the only domain-level discriminators currently exposed.
- `packages/server/src/trpc/trpc.ts:57-75` — `formatTrpcError` already centralizes the safe wire shape, removes the stack, and conditionally exposes sanitized `validationErrors` from a `ZodError` cause.
- `packages/client/src/lib/trpc-error.ts:18-30` — the client already has an assertion-free defensive narrowing pattern for `data.code`, but no equivalent for a domain reason.
- `packages/server/src/routers/auth-delete-account.test.ts:120-133` — the account-deletion integration test asserts that the response message contains `"Transfer or delete campaigns"`, pinning presentation prose rather than a stable machine contract.
- `packages/client/src/test/mock-trpc-helpers.ts:4-15` — the shared fake tRPC error exposes only `data.code`, so migrated-flow mocks cannot yet exercise a reason code.
- `packages/server/src/socket/connection-handler.ts:14-19` — the per-packet
  rate limiter represents rejection only as an ordinary `Error` whose message
  is `"Rate limit exceeded"`.
- `packages/server/src/socket/connection-handler.ts:36-39` — the socket error
  handler derives `RATE_LIMIT` by comparing `err.message` with that exact
  presentation string; every other message becomes `INTERNAL_ERROR`.
- `packages/server/src/socket/connection-handler.test.ts:176-193` — the test
  named for `RATE_LIMIT` categorization only proves the socket remains
  connected and responsive; it never observes the emitted payload or asserts
  its `code`.

## Proposed direction

1. Add a shared Zod enum for stable domain reasons, for example in `packages/shared/src/schemas/error-reasons.ts`, following the normal shared → server → client dependency flow. The bounded initial vocabulary should cover `invite_invalid`, `invite_expired`, `invite_full`, `already_member`, `character_not_found`, `password_incorrect`, and `owned_campaigns_exist`, with its TypeScript type inferred from the schema.

2. Add a small server helper that creates or throws a `TRPCError` with a typed reason carrier in `cause`. Extend `formatTrpcError` in `packages/server/src/trpc/trpc.ts` so every response includes `data.reasonCode: ReasonCode | null`, analogous to `validationErrors`. The formatter must surface only the parsed code, default to `null`, continue removing stacks, and never serialize other cause internals. Add formatter tests beside `packages/server/src/trpc/trpc.test.ts`.

3. Add `readReasonCode(error): ReasonCode | null` beside `readErrorCode` in `packages/client/src/lib/trpc-error.ts`. Use field-presence checks and the shared enum's `safeParse`; keep this narrowing assertion-free. Extend `FakeTRPCError` in `packages/client/src/test/mock-trpc-helpers.ts` so relevant client tests can provide `data.reasonCode`.

4. Tag all server throw sites feeding the three flows:

   - Both invalid-invite sites, the expired path, and the already-member/full paths in `packages/server/src/services/invite-service.ts`.
   - The incorrect-password and owned-campaign blockers in `packages/server/src/routers/auth.ts`.
   - Both missing and forbidden branches of `character.get` in `packages/server/src/routers/character.ts` with the same masked `character_not_found` reason.

5. Migrate both invite callers by changing `mapJoinError` to accept the error or parsed reason rather than a message. Replace the literal-message branches in `character-sheet-page.tsx` and `settings-page.tsx` as well. Remove the old equality and substring fallbacks completely: retaining them would leave the silent prose dependency in place.

6. Use tests as wire-contract tripwires. Update `invite-errors.test.ts` for the new signature, cover both masked `character_not_found` branches, and change `auth-delete-account.test.ts:129` to assert `reasonCode` rather than response prose. A final source search across the three migrated client files should find no control-flow comparisons against the old server messages.

7. Add a local tagged or custom rate-limit error for
   `connection-handler.ts`. Have the packet middleware create that error and
   have the socket error handler inspect its stable discriminator when mapping
   to `RATE_LIMIT`; keep the message in the emitted payload unchanged and map
   untagged errors to `INTERNAL_ERROR` as today. Replace the current
   categorization test with a focused case that forces rejection, observes the
   emitted error payload, and asserts both `code: "RATE_LIMIT"` and the
   unchanged presentational message.

## Scope / caveats

- Do not migrate every `TRPCError` or classify every Socket.IO error in the
  repository. This leaf establishes the tRPC contract for the three evidenced
  client flows and adds only the bounded socket rate-limit discriminator.
- Do not change user-facing copy as part of this work. Messages remain useful presentation text; they simply stop controlling behavior.
- Do not alter the toast-catalog dispatch in `onTRPCError` beyond adding the shared narrowing helper.
- Character existence masking is binding: nonexistent and forbidden characters must expose the same `NOT_FOUND` code, message, and `character_not_found` reason, consistent with `docs/authorization.md:3-14`.
- Coordinate the `owned_campaigns_exist` path with [187-add-campaign-ownership-transfer-account.md](./187-add-campaign-ownership-transfer-account.md). Ownership transfer changes how a user can clear the blocker, but does not remove the blocker or its reason code.
- Read the nearest module documentation before implementation: invite-service work is governed by `packages/server/src/services/invite-MODULE.md`, while the page work is covered by `packages/client/src/pages/MODULE.md`.
- Keep the socket tag local to the rate-limit connection-handler flow. It does
  not add a value to the shared tRPC reason-code vocabulary, pass through
  `formatTrpcError`, or establish a repository-wide Socket.IO error taxonomy.
- Serialize the `JoinPage` and `CharacterSheetPage` edits with
  [248-preserve-registered-route-typing-through.md](./248-preserve-registered-route-typing-through.md):
  if 248 lands first, migrate only the surviving invite and character error
  branches; if this leaf lands first, 248 removes the now-impossible
  missing-parameter branch while preserving reason-code-based domain error
  handling.
