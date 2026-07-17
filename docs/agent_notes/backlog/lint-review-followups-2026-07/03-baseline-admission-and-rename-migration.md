# 03 — Baseline admission artifact + rename migration

Status: Done — `4a260e12` (`--admit <identity> --reason`, rename migration, reasons survive merges/truth-up)
Track: S (sensors/gates) · Priority: P2 · Size: M

## Evidence (verified 2026-07-15 on feat/lint-adoption-2026-07 pre-land; re-verify before implementing)

- Pair identities embed file paths and function names
  (`scripts/sensor-near-duplicates-baseline.ts:32`), and update mode rejects
  every added identity (`scripts/sensor-near-duplicates-core.ts:201`): a
  file move or function rename turns an admitted duplicate into
  unresolvable "new debt" with unchanged code. This bites first on any
  refactor touching baselined pairs.
- The baseline schema stores only identity, paths, and count — no admission
  reason (`scripts/sensor-near-duplicates-baseline.ts:42`).
- Field consequence: the gate's initial 31-identity baseline (commit
  `ffb3f3c2`, `feat(harness): gate staged near-duplicate clones`) bulk-
  absorbed three byte-identical `staticPropertyName` clones with no
  adjudication trail, so "detected but frozen as debt" was indistinguishable
  from "never detected" until a cross-model review re-found them by hand.
  (Those specific pairs were drained on the branch; the mechanism gap
  remains.)

Failure: renames of baselined code dead-end the gate, and admissions carry
no reviewable "why", so every bulk baseline silently launders fresh debt.

## Do

One mechanism serves both problems (per the 2026-07-15 adjudication —
preferred over teaching the sensor rename-mapping recognition).

Alternative considered (record so the implementer does not rediscover it):
make the identity itself less path-dependent — key pairs on a normalized
content hash, or match on either path-identity or content-hash during
`--update`. That eliminates the rename dead-end mechanically instead of
procedurally, at the cost that editing baselined code resets its identity
and resurfaces it as new debt (arguably correct: changed code deserves
re-adjudication). Ship `--admit` first — the reason trail is valuable
independent of renames — but revisit the identity scheme if rename-admits
become frequent friction.

1. Add an `--admit <identity> --reason "<text>"` path that appends to a
   reviewed admissions section of the baseline; `--update` stays shrink-only
   for everything else.
2. Renames migrate through the same route: admit the new identity with a
   `renamed from <old identity>` reason while the old identity drops —
   net count unchanged, history reviewable.
3. Document the process rule alongside the gate docs: initial baselines are
   generated against the protected branch before lane fan-out; same-pack
   identities need a fix or a written admission reason. (A first paragraph
   of this landed with DO NOW commit B — extend it to describe `--admit`.)

## Verify

```
bun scripts/sensor-near-duplicates.ts --check-baseline
bun run test:scripts:file -- scripts/sensor-near-duplicates.test.ts
bun run verify:changed
```

## Acceptance

A rename of a file containing a baselined pair is resolvable via `--admit`
without growing net debt; every admitted identity in the baseline carries a
reason string; a bare `--update` still refuses added identities; tests pin
the admit/rename/reject paths.

Sources: codex cross-review P1 + gate-miss investigation rec 5;
Fable 5 adjudication (better ways #2).
