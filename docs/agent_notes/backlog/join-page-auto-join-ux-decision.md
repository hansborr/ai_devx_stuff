# Join Page Auto Join UX Decision

Status: Parked
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
