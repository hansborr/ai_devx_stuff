# 04 — Gate timing constants duplicated as bare literals

Status: Done — constants placed in `scripts/lib/verify-metadata.sh` rather than `gate-env.sh` (all consumers already source it)
Track: T (tooling) · Priority: P2 · Size: S

> **Confirmed — 2026-07-11 adversarial triage.** Every cited line still exact
> at HEAD; only a label nit — the three `verify-metadata.sh` defaults belong to
> `musi_success_marker_matches` (458), `musi_restamp_verify_marker` (529), and
> `musi_try_verify_marker_bridge` (597). Implementation caveats for the
> promoter: (1) `verify-metadata.sh:219` has an uncited `:-3600` default that is
> the commit-queue waiter-ticket max age, a *different* semantic — do not fold
> it into the pre-push freshness constant; (2) the 1200s watchdog is already a
> shared env var (`MUSI_INTERACTIVE_TIMEOUT`) whose default is duplicated in two
> files, so only the default needs hoisting; (3) the pre-commit header comments
> (lines 13, 17) hardcode 120s/1200s in prose and should be repointed at the
> constants.

## Evidence (verified 2026-07-11; re-verify before implementing)

- 120s marker freshness appears as a bare literal in `.husky/pre-commit:302`
  and `:316`, `scripts/verify.sh:172`, and is defaulted independently three
  times in `scripts/lib/verify-metadata.sh:458,529,597` (short-circuit,
  manual-verify bridge, and marker-bridge paths).
- The 1200s pre-commit watchdog (`.husky/pre-commit:251`), the verify
  watchdog (`scripts/verify.sh:90`), and the 3600s pre-push full-verify
  freshness (`.husky/pre-push:37`) are likewise per-file literals.

Freshness policy can silently drift between the short-circuit, the bridge,
and manual verify; the heap policy already models the fix (`gate-env.sh`).

## Do

Hoist the timing budgets into one shared, named location (e.g. alongside
`gate-env.sh` or in `verify-metadata.sh` exported constants) and reference
them everywhere; keep env-var overrides where they exist today.

## Verify

```
bun run test:scripts:changed
grep -rn '\b120\b\|\b1200\b\|\b3600\b' .husky scripts/verify.sh scripts/lib/verify-metadata.sh
```

## Acceptance

Each timing budget has exactly one definition; the gates and verify paths
read the shared constants.
