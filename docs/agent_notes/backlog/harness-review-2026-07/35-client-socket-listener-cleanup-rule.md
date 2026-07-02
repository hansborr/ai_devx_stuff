# 35. Custom rule: `socket.on` listeners must have paired `socket.off` cleanup and live in approved socket hook files

Status: Done for the pairing half in b1d220ba; approved-file boundary half deferred and NOT implemented. Re-verify file:line before resuming boundary work.
Lens: lint-rules · Area: client · Severity: med-high · Size: M · Confidence: med
Theme: socket-listener-hygiene · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
A `socket.on` registered in an effect without a matching `socket.off` in the cleanup leaks
listeners across remounts — duplicate cache writes, duplicate toasts, and memory growth that
only shows up after navigation churn, which agents and unit tests never exercise. The guide
requires cleanup (`docs/guides/add-client-feature-module-cache-socket.md:39`: "always
unregister with the matching `socket.off`"), but only socket-client CONSTRUCTION is enforced
today; listener lifecycle is prose.

## Evidence
- Construction-only enforcement verified: `eslint-config/client-configs.js:106-127` bans
  importing `socket.io-client` outside `packages/client/src/hooks/socket-context.tsx`
  ("Use the app SocketProvider/useSocket hooks…"). Nothing looks at `.on`/`.off`. (The audit's
  "~line 106" holds — the config block starts at line 106.)
- Current non-test `socket.on(`/`socket.off(` sites — 4 files, all correctly paired today:
  `hooks/realtime-invalidation.ts` (5 on / 5 off), `hooks/use-campaign-presence.ts` (4/4,
  lines 96-109), `hooks/use-notifications.ts` (1/1, lines 50-53),
  `components/campaign/chat/chat-panel.tsx:118-120` (1/1).
- So the pairing half has **0** current findings; the "approved files" half has **1**
  (`chat-panel.tsx` is a component, not a realtime/socket hook file) if the allowlist is
  hooks-only.
- Guide also demands tests cover "listener registration and cleanup"
  (`add-client-feature-module-cache-socket.md:54`) — more prose without lint teeth.
- Precedent for effect-scoped AST analysis: `eslint-rules/no-broadcast-in-transaction.js`
  (callback tracking); authoring contract in `docs/guides/local-eslint-rules.md`.

## Proposed direction
Local rule `local/socket-listener-cleanup`, two checks:
1. Inside a `useEffect` callback, every `socket.on(<event>, <handler>)` must have a matching
   `socket.off(<event>, <handler>)` (same event literal, same handler identifier) inside the
   effect's returned cleanup function. Report the `on` call otherwise. `socket.on` outside a
   `useEffect` entirely is also a report (no lifecycle to clean it).
2. File-boundary check: direct `socket.on`/`socket.off` allowed only in an approved list —
   proposal: `packages/client/src/hooks/**` (or narrower: the four existing realtime hook
   files) — everything else must consume the existing hooks.
Message guidance shape, pairedGuide `docs/guides/add-client-feature-module-cache-socket.md`,
register in `eslint-config/local-plugin.js`, RuleTester tests covering the
paired/unpaired/wrong-handler/outside-effect matrix.

## Current implementation split
- Done: the pairing half is implemented as `local/socket-listener-cleanup`, registered in normal
  client lint, and covered by RuleTester tests. The active rule enforces listener lifecycle pairing
  only; it intentionally does not enforce an approved-files boundary.
- Deferred: the approved-files/file-boundary half remains future work. The known migration target is
  the direct listener in `packages/client/src/components/campaign/chat/chat-panel.tsx`; resume by
  re-verifying that site and deciding whether to move it behind a hook or record an intentional
  allowlist. Do not treat the pairing-half commit as completion of this boundary half.

## Scope / caveats
- Rollout decision per house convention: check 1 has zero findings → normal lint directly.
  Check 2 depends on the allowlist choice — hooks-only leaves `chat-panel.tsx:118` as the
  single finding; either migrate its listener into a small `use-chat-messages` hook in the
  same commit (preferred, matches the module guide) or add it to the allowlist and note the
  debt. Avoid a 1-item ratchet.
- Handler-identity matching should be conservative: identifier-to-identifier only. Inline
  arrow handlers in `on` are auto-reports (they can never be `off`'d correctly) — that is the
  bug class, not a false positive.
- `mock-use-socket.ts` and `*.test.*` files stay out of scope
  (`packages/client/src/test/**`).
- Does not attempt to verify `off` event-name/handler correctness across helper indirection
  (e.g. registering via a loop) — none exists today; revisit if the realtime hooks refactor.
- One small commit: rule + tests + registration + config enable (+ the chat-panel migration
  if the hooks-only allowlist is chosen).
