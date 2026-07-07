# 37. `socket-listener-cleanup` false-positives on member-expression event names — correct cleanup is unmatchable

Status: Done — implemented on fix/lint-rule-holes-lane; member-expression event cleanup now pairs by source text.
Lens: local rules · Area: socket hygiene · Severity: med (was med-high; latent — verified 2026-07-04) · Size: M · Confidence: high
Theme: rule-false-positive · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
This is the pack's one confirmed *false positive* (the rest are false
negatives). It was first ranked priority ("false positives teach agents to
suppress"), but the 2026-07-04 review verified it is **latent** — client
code passes string-literal event names everywhere today (see evidence) — so
it does not need to jump the rule-work queue; it detonates repo-wide the day
the client adopts a shared event-constants object. Mechanism, verified
end-to-end: `eventName()` returns a key only
for string literals, single-quasi templates, or const-string identifiers; a
member-expression event like `SOCKET_EVENTS.updated` yields `undefined`. The
`on` call is then stored with `key: undefined`, the matching `off` call is
dropped at the `if (!listenerCall.key) return;` guard, and `hasCleanupFor`
can never match a falsy key — so the rule reports `missingCleanup` even for
textbook-correct pairs:

```ts
useEffect(() => {
  socket.on(SOCKET_EVENTS.updated, handleUpdated);
  return () => socket.off(SOCKET_EVENTS.updated, handleUpdated);
}, [socket]);   // reported anyway
```

Only `removeAllListeners()` escapes. The test suite covers const-string
identifier events and member-expression *handlers*, but no member-expression
*event* — the gap is uncovered.

## Evidence
- `eslint-rules/socket-listener-cleanup.js:56-60` (eventName), `:132-137` (undefined key), `:245-249` (on stored), `:267` (off dropped), `:178-181` (unmatchable). Verified 2026-07-04.
- `eslint-rules/socket-listener-cleanup.test.js:72-88` — the near-miss coverage.
- Latency check 2026-07-04 (verification agent): rule enabled at error on
  client source (`eslint-config/client-configs.js:210`); zero suppressions
  under `packages/`; all real `.on`/`.off` calls in `packages/client/src`
  use string-literal event names — no `SOCKET_EVENTS.*` member usage exists
  yet.

## Proposed direction
Fall back to a source-text key (`sourceCode.getText(eventArg)`) for
non-literal event expressions — pairing `on`/`off` by identical source text is
exactly right for the constant-object convention, and remains conservative
(different text = no pairing, same behavior as today for genuinely dynamic
events... except today's behavior is report; decide: unresolvable events with
a same-text `off` present should pair; unresolvable with none should still
report). Add tests: member-expression event with cleanup (valid), without
(invalid), aliased-but-differently-spelled (documented behavior).

## Scope / caveats
- Convention check done 2026-07-04: string literals are the universal form
  in client code and no suppressions of this rule exist — nothing to clean
  up today; the fix is pure future-proofing.
- One commit: rule + tests.
