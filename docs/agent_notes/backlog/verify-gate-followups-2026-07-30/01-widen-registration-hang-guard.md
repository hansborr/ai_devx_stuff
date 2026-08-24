# Widen the Pre-Commit Registration Hang Guard to 45 Seconds

Status: Done — landed 2026-07-30 (`fc24199cd`)
Date: 2026-07-30
Priority: P1
Size: S
Source: owner follow-up to
[`pain-points-2026-07-29` leaf 04](../pain-points-2026-07-29/04-retune-registration-admission-timeout.md)

## Problem

The pre-commit registration admission defaults
`MUSI_PRECOMMIT_REGISTRATION_TIMEOUT` to 15 seconds at
`.husky/pre-commit:303` and consumes it at `.husky/pre-commit:378`.
[`verify-gate-lifecycle.md` §5](../../../guides/verify-gate-lifecycle.md#5-classify-timing-before-setting-a-budget)
classifies this ceiling as a hang guard: it must be calibrated from
representative same-gate measurements with a recorded margin, not treated as a
performance assertion.

The archived correct completions reach approximately 8–9 seconds. They include
5.1–7.5-second standalone runs, a roughly 5.07-second cold run, approximately
8 seconds through `bun run harness:registration:check`, and a separate
6.5–9-second loaded observation
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:179-186`,
`:262-275`, `:354-357`, and `:702-707`). The archive's later spinner forensics
corrects the co-tenant attribution for a separate memory-fixture incident; it
does not attribute every registration observation to those spinners
(`:732-750`).

Against the approximately 9-second maximum, 15 seconds supplies only about
1.7× margin. The neighboring guards are materially wider:

- actionlint defaults to 60 seconds at
  `scripts/lint-config-sensors.sh:269`; the
  [closed actionlint leaf](../pain-points-2026-07-29/05-retune-actionlint-timeout.md)
  records a 2.620-second concurrent maximum, about 23× margin;
- `resolvedConfigTestTimeoutMs` is 30 seconds against the approximately
  1.2-second baseline recorded in
  `eslint-rules/eslint-config-resolution-timeout.js:3-20`, about 25× margin.

Registration is therefore the one live hang guard that does not survive the
timing doctrine the repository now publishes. Leaving it unreconciled invites
another incident-driven ratchet.

## Scope

- Change only the default at `.husky/pre-commit:303` from `15` to `45`; retain
  the existing positive-whole-second override grammar and the
  `timeout --foreground --signal=TERM --kill-after=1s` invocation at
  `.husky/pre-commit:376-380`.
- Update the matching structural contract in
  `scripts/harness/registration-preflight-wiring.ts:79-90`, its mutations in
  `scripts/harness/registration-preflight-wiring.test.ts:42-123`, the
  representative hook source in `scripts/tests/test-harness-check.sh:302-314`,
  and the production-argv assertion around
  `scripts/tests/test-dependency-freshness.sh:2070-2136`.
- Update the 15-second description in
  `docs/guides/verify-gate-lifecycle.md:52-54`.
- Preserve registration ordering, evidence restoration, retry guidance,
  override behavior, and all behavioral slot commands.
- Cross-reference the closed leaf 04 as the superseded reasoning record; do not
  rewrite it.

## Acceptance

- With no override, the production invocation is exactly `timeout --foreground
  --signal=TERM --kill-after=1s 45s bun run
  harness:registration:check`; an explicit valid override remains verbatim.
- Invalid configuration still exits 2 before registration or any behavioral
  slot starts.
- A passing registration run has no added wall time: it returns when the
  command completes and never reaches the ceiling.
- A genuine registration deadlock is reported after 45 seconds, 30 seconds
  later than today. Its existing failure evidence and retry guidance remain
  intact.
- The focused wiring test, harness-check smoke, and dependency-freshness smoke
  pass.

## Resolved decisions

- Use 45 seconds. The direction is owner-approved; this leaf records the work
  rather than reopening the budget choice.
- This decision supersedes leaf 04's conclusion that “30 would only defer
  detection of a stuck structural admission.” The design panel identified
  that conclusion as performance-assertion reasoning misapplied to a hang
  guard. The honest cost is accepted: genuine deadlocks take 30 seconds longer
  to report, while green runs pay no cost.

## Open questions

None.
