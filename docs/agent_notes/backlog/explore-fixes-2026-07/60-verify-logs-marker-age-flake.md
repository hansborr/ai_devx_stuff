# 60 — De-flake `test-verify-logs` marker-age assertions

Status: Ready
Track: TS (tests) · Priority: P1 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/tests/test-verify-logs.sh:466` — asserts on wall-clock
  seconds-based age text; `:126`/`:136` use real `sleep`s to age markers.
- `docs/generated/observed_flaky_tests.md:179` — this exact assertion has
  already flaked under load.

## Do

Remove the wall-clock sensitivity: pin/fake the timestamp the
marker-age text derives from (e.g. write markers with explicit back-dated
mtimes via `touch -d`), or assert on state/path semantics rather than the
rendered seconds text. Drop the real `sleep`s where the back-dating makes
them unnecessary.

## Verify

```
bash scripts/tests/test-verify-logs.sh
```

(run a few times, ideally under load, to confirm stability)

## Acceptance

No assertion depends on real elapsed wall-clock time; the suite passes
repeatedly; the observed_flaky_tests entry for this can be marked resolved
(see leaf 70's pattern).
