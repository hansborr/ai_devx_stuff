# Retune the Registration Admission Timeout

Status: Implemented — superseded
Date: 2026-07-29
Priority: P1
Size: S
Source: `gate-timeouts-and-load.md` — “Registration admission: hard 5-second
budget”

> **Superseded.** The live default is now 45 seconds, set by
> [`verify-gate-followups-2026-07-30` leaf 01](../verify-gate-followups-2026-07-30/01-widen-registration-hang-guard.md).
> Every 15-second statement below — including the acceptance criteria and the
> pinned production argv — is this leaf's historical reasoning record, not the
> current contract.

## Problem

The pre-commit registration admission has a literal five-second ceiling at
`.husky/pre-commit:341-344`. Persisted loaded-lane observations put the same
structural check between roughly four and nine seconds; it passes directly and
fails only inside a contended gate.

The failure is now correctly captured and labeled:
`scripts/lib/verify-engine.sh:666-700` writes the timeout diagnostic and
`scripts/tests/test-dependency-freshness.sh:1979-2016` pins evidence
restoration and retry guidance. The remaining issue is the budget itself. A
sibling lane's CPU demand can turn a correct commit into a registration
failure before behavioral slots start.

Fresh measurements on this 16-core host found three idle runs at
1.214-1.227 seconds and sixteen concurrent foreground runs at
3.626-4.391 seconds. The archive includes 5.1-7.5-second standalone runs,
6.5-9-second loaded runs, and an approximately eight-second `bun run` run
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:179-186`,
`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:262-275`,
and
`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:702-707`).
Fifteen seconds covers every recorded valid run with at least six seconds of
headroom while still detecting a genuinely stuck structural check promptly.

This leaf owns a load-sensitive timeout only. It does not change registration
coverage, direct verify state identity, the shared commit queue, or failure-log
attribution.

## Correction — 2026-07-30

The contention cause stated above is retained as the original diagnosis but is
not established by the archived measurements. The archive records 5.1–7.5
seconds standalone and roughly 5.07 seconds cold versus 2–3 seconds warm
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:262-275`
and `:354-357`), so the five-second guard lacked margin over observed cold and
standalone runs. Those labels do not establish an unloaded host. The later
spinner forensic entry explicitly retracts the “~15 co-tenant worktrees”
attribution for the memory-fixture incident; it does not attribute every
registration observation to those spinners (`:732-750`).

The durable classification is a hang guard with insufficient recorded margin;
sibling-lane causation was observed as correlation, not established. This is
not evidence for CPU arbitration or a load-adaptive budget, and the implemented
15-second correction remains unchanged.

## Scope

- In `.husky/pre-commit`, replace the literal `5s` with
  `MUSI_PRECOMMIT_REGISTRATION_TIMEOUT`, defaulting to positive whole seconds
  `15`, written as bare digits without a suffix or leading zero. Validate the
  resolved setting during configuration, before gate-policy dispatch; a zero,
  zero-padded, negative, suffixed, or nonnumeric value must emit
  `pre-commit: invalid MUSI_PRECOMMIT_REGISTRATION_TIMEOUT=<value>; expected
  positive whole seconds without a suffix or leading zero (for example, 30)`
  and return configuration exit 2.
- Keep `timeout --foreground --signal=TERM --kill-after=1s`, and pass the
  validated value to GNU `timeout` with an `s` suffix. Do not change the
  admission command or the gate engine's failure/evidence handling at
  `scripts/lib/verify-engine.sh:666-700`.
- Update `scripts/harness/registration-preflight-wiring.ts:75-102` so the
  structural check requires the named 15-second default, positive-integer
  validation, and the same foreground/TERM/kill-after command. Add mutations
  for each contract to
  `scripts/harness/registration-preflight-wiring.test.ts:37-123`.
- Update the representative hook source in
  `scripts/tests/test-harness-check.sh:291-310` to satisfy the new structural
  contract.
- Extend `scripts/tests/test-dependency-freshness.sh` around the fast
  registration fixtures at lines 1940-2016. Use fixture-local `timeout`/`bun`
  stubs to record arguments without sleeping, and pin: default `15s`, an
  explicit `MUSI_PRECOMMIT_REGISTRATION_TIMEOUT=23`, invalid `0` and
  nonnumeric values exiting 2 before the registration command, and the
  existing exit-124 log restoration/retry guidance.

## Acceptance

- The fixture-observed production invocation is exactly `timeout --foreground
  --signal=TERM --kill-after=1s 15s bun run
  harness:registration:check`; override `23` produces `23s`.
- Invalid `0`, negative, suffixed, and nonnumeric values exit 2 with the named
  configuration diagnostic and do not invoke registration or behavioral
  slots. Unset or empty uses the documented default.
- A simulated exit 124 blocks pre-commit, leaves `registration.log` with the
  existing retry guidance, restores the prior evidence set, and reports
  `Failed: registration`.
- Registration still runs exactly once, after staged/source admission and
  before marker/bridge evaluation and behavioral slots.
- `bun run test:scripts:file --
  scripts/harness/registration-preflight-wiring.test.ts`,
  `bash scripts/tests/test-harness-check.sh`, and
  `bash scripts/tests/test-dependency-freshness.sh` pass.

## Resolved decisions

- Default to 15 seconds, not 30. Fifteen exceeds the archived nine-second
  maximum and the live 16-way maximum by substantial margins; 30 would only
  defer detection of a stuck structural admission.
- Use `MUSI_PRECOMMIT_REGISTRATION_TIMEOUT` as bare positive whole seconds.
  This keeps shell validation explicit and makes the unit unambiguous at the
  operator seam; the diagnostic names the form because actionlint's separate
  seam accepts GNU duration syntax.
- No entry in the hand-maintained
  `docs/generated/observed_flaky_tests.md` records registration admission; no
  incident-log edit is required for this leaf.

## Open questions

None.
