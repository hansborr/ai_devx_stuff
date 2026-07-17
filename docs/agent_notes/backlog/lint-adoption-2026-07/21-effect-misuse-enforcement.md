# 21 — Effect-misuse enforcement: convert the client-effects guide into lint

Status: Done (2026-07-15) — merged via `ab318d05` / `4528e972`.
Track: L (lint rules) · Priority: P1 · Size: M
Created: 2026-07-15

> 06/07/08 all P1. Unanimous: do **not** ban `useEffect` (Factory's ban is the
> anti-example). Codex framing: the guide's decision table should become rule
> metadata and diagnostic alternatives, not remain prose.

## Evidence (verified 2026-07-15; re-verify before implementing)

- `docs/guides/client-effects.md` names "reset form state on prop change" as
  an anti-pattern; the ratchet freezes exactly that debt:
  `scripts/lint-ratchet/lint-ratchet-config.ts:202`
  (`ratchet/react-hooks-set-state-in-effect-client`, no-new floor) with the
  rule itself off in `eslint-config/client-configs.js:139`.
- The research counted the frozen violations as one structural fingerprint —
  the same reset-on-prop-change pattern, mostly `*-dialog.tsx` files.

Existing parked notes own parts of this decision — promote alongside, do not
duplicate:

- [`../dialog-reset-on-open-convention.md`](../dialog-reset-on-open-convention.md)
  — the key-remount vs helper convention choice that drains the dialog cohort.
- [`../useeffect-guardrails-implementation-plan.md`](../useeffect-guardrails-implementation-plan.md)
  and [`../useeffect-ai-agents-research.md`](../useeffect-ai-agents-research.md)
  — the existing guardrail plan (no-new ratchet, gated
  `react-you-might-not-need-an-effect` trial, hard-ban rejection).
- [`../join-page-auto-join-ux-decision.md`](../join-page-auto-join-ux-decision.md)
  — one cohort member gated on a product decision.

## Do

1. Decide the dialog convention (key-remount per the guide is the default
   candidate), drain the frozen `set-state-in-effect` cohort with it — a
   perfect worked example for the talk — then promote the ratchet floor
   toward zero.
2. Add high-signal detection for query/fetch-inside-effect and
   derived-state-only effects: trial
   `eslint-plugin-react-you-might-not-need-an-effect` (already planned in the
   parked guardrails note) or a local port if its noise profile fails.
3. Encode the guide's decision table ("is this external-system sync?") into
   the rule messages as diagnostic alternatives, so the fix guidance names
   the right non-effect shape (derived state, event handler, query hook).

## Verify

```
bun run lint:ratchet:check-baseline
bun run --filter @musi/client test
```

## Acceptance

- The dialog cohort is drained via the chosen convention and the ratchet
  floor is promoted (or the residual is re-frozen with reasons).
- Fetch-in-effect and derived-state-only effects fire a rule with
  guide-aligned fix alternatives; the rule is ratcheted, not a blanket ban.
- The parked notes above are updated/absorbed rather than left duplicating
  this leaf.

## Outcome

- Adopted keyed remounts as the dialog reset convention and removed the full
  15-file dialog/editor cohort plus the weapon-mastery `prevOpen` loophole.
  The official set-state floor first dropped from 21 findings to 6, then to 5
  when review exposed and fixed the movement-tracking bug described below.
- Added `local/no-effect-misuse` with distinct, guide-aligned diagnostics for
  imperative fetch/query work and setter-only effects. Its no-new ratchet was
  captured at 12 findings before cleanup and tightened to 2 afterward; a
  temporary fetch probe proved a new path blocks.
- Rejected the uncalibrated third-party plugin for this slice in favor of the
  narrower local rule. The join-page auto-join mutation remains deliberately
  parked on its product decision because it is neither fetching nor derived
  state.

Residual floors are intentionally re-frozen rather than folded into this
dialog-convention slice:

- The five official set-state findings comprise socket/presence/image external
  synchronization, inline ability-score draft synchronization, and debounced
  cursor pagination state.
- The two narrower local findings are the inline score draft and cursor-list
  reset. Removing either needs a state-ownership redesign that preserves an
  edit in progress or accumulated pagination respectively; neither is a dialog
  reset or fetch-in-effect finding.
- The continuation/provenance follow-up below added no residuals. The local
  floor remains exactly those two state-ownership findings; no fetch/query
  finding was added to the baseline.

### Review follow-up: movement tracking was a real bug

`mapToken.move` invalidates the map-detail query. Before the follow-up, that
same-turn refresh changed the `map` object dependency in `useMovementTracking`,
reset `distanceFt` to zero, and moved `turnStartPos` to the token's refreshed
position. A focused hook test reproduces the sequence: move from column 0 to 2
(10 ft), rerender with a new map object whose token is at column 2, then move to
column 3. The broken hook reported 0 after the refresh; the fixed hook preserves
10 and then reports 15 from the original turn origin.

Movement state is now keyed by stable encounter/state/round/turn/map/
participant/token identity. Map object identity and token coordinate refreshes
do not reset it, while a real combatant, turn, linkage, or map boundary still
does. The movement file was removed from the official frozen floor rather than
documented as accepted debt.

### Review follow-up: effect-owned async flow and client provenance

Cross-model review of the narrowing commit found three confirmed false-negative
families. The rule now follows effect-owned promise continuations
(`then`/`catch`/`finally`) and browser timer/scheduling callbacks while still
stopping at socket, DOM event, and subscription registrations. It also carries
recognized tRPC-client provenance through simple aliases, member selection,
and object destructuring, traces same-file helper calls, recognizes the
canonical `fetchCurrentUser` tRPC helper import, and treats `globalThis.fetch`
and `window.fetch` like bare global `fetch`. The pinned
`navigator.permissions.query()` and unproven-object `.query()` cases remain
clean.

The wider rule surfaced one client finding in the mount-time auth bootstrap:
after refreshing the session, the effect imperatively queried `auth.me`. The
refresh router already loaded the session user, so the shared refresh response
now returns that user with the new access token and the provider hydrates both
directly. This removes the redundant round trip instead of accepting new lint
debt. A full client ratchet collection returned to the existing two-finding
local floor with no baseline count growth; only the local-rule source hash was
refreshed.
