# Join Page Auto Join UX Decision

Status: Done — implemented 2026-07-25 on `fix/join-page-confirm` (`F8` in
`ready-2026-07/00-index.md` §1). The decision was explicit "Join campaign"
confirmation, not silent auto-join. What landed: the `useEffect` and its
`exhaustive-deps` disable are gone with no route-action seam; the dead
"Please log in to join this campaign" branch is gone; a read-only
`invite.preview` query names the campaign before anything is claimed; and the
logged-out invite flow is fixed by the `F1` return-to pathway.

> **2026-07-25 ruling and dispatch notes.** Confirmation wins because it is the
> only option that removes the effect rather than relocating it (see
> `docs/guides/client-effects.md`), and because the server contract makes
> auto-join a real hazard: `invite-service.ts:57-63` increments `uses` under
> `where: { uses: { lt: maxUses } }`, so a page load permanently consumes one of
> a bounded number of invite seats and creates a `campaignMember` row before the
> user has seen the campaign's name. Re-visiting is safe (`:49-54` throws
> `CONFLICT` for an existing member), so the hazard is first-load only.
>
> Delete the `useEffect` at `join-page.tsx:33-39` and its `exhaustive-deps`
> disable; no route-action seam is needed. Rewrite `join-page.test.tsx:76-117`
> (the "joins once" / "does not join more than once" tests become obsolete) and
> add `JoinPO.clickJoin()` alongside the existing
> `JoinPO.expectRedirectToCampaign()`.
>
> Two findings this note never recorded, to fold in: **(1)** `join-page.tsx:41-58`
> (the "Please log in to join this campaign" branch) is dead code — the route is
> already `AuthGuard`-wrapped at `routes/join-route.ts:8-15`, so it can only
> render in a bare unit-test mount. **(2)** The logged-out invite flow is broken
> today: `AuthGuard` navigates to `/login` with no return-to param and
> `GuestGuard` (`guest-guard.tsx:23-24`) unconditionally bounces to
> `/dashboard`, so anyone clicking an invite link while logged out never joins.
> A confirmation screen that names the campaign and survives a login round-trip
> fixes this nearly for free — pair with `F1`.
Date: 2026-07-03
Source: Deferred repo-audit finding from the docs/process staleness cleanup.

## Context

`packages/client/src/pages/join-page.tsx:33-39` automatically calls
`joinMutation.mutate({ code })` from a `useEffect`, guarded by a ref and an
`exhaustive-deps` disable. That is not just a hook-shape cleanup: replacing it
properly changes the join flow.

The plausible fixes have different UX semantics. An explicit "Join campaign"
confirmation button avoids automatic mutation on page load. A router/action
style approach keeps the auto-join behavior but moves the mutation out of a
component effect. This needs an owner call before implementation.

## Scope

- Decide whether invite links should auto-join authenticated users or require
  explicit confirmation.
- If confirmation wins, replace the effect with a user-triggered mutation and
  update page tests around the new button/error states.
- If auto-join wins, move the mutation to an appropriate route/action seam
  rather than a component `useEffect`.
- Remove the `exhaustive-deps` disable as part of the chosen implementation.

## Verification

- Focused `join-page` client tests for the chosen flow.
- Manual or e2e smoke for login-then-join and already-authenticated invite
  links if the behavior changes.

## Leaf 21 boundary

The 2026-07-15 effect-misuse enforcement deliberately does not classify this
mutation as fetch-in-effect or derived-state-only work. The product choice
between automatic joining and explicit confirmation still determines the
correct replacement, so this note remains the single owner of that decision;
Leaf 21 neither duplicates nor silently resolves it.
