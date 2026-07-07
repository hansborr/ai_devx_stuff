# 10 — Run the coverage-map audit form in CI

Status: Ready
Track: T (tooling) · Priority: P1 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `.github/workflows/ci.yml:95-96` — the "Check lint coverage map" step
  runs `bun run docs:lint-coverage-map:check` (no reach probe).
- `scripts/verify/steps.generated.sh:35,93` — full and parallel verify run
  `docs:lint-coverage-map:audit` (which bakes in `--check-eslint-reach`,
  `package.json:91`); changed/pre-commit run `:check --staged` (`:62,120`).
- `docs/guides/lint-ratchet.md:282-289` — "Full mode … should run with
  `--check-eslint-reach` in CI or full verification."
- `scripts/harness-check.ts:71-75` — documents the tiering: pre-commit
  deliberately skips the audit; full verify runs it. Nothing exempts CI.

Net effect today: the ESLint-reach probe runs on no automated surface —
CI uses the weaker `:check`, and pre-commit/`verify:changed` intentionally
skip it — so a reach regression merges green unless someone happens to run
bare `bun run verify`.

## Do

Change the CI step to `bun run docs:lint-coverage-map:audit`. Do NOT wire
the audit into `verify:changed`/pre-commit (staged `:check` is intentional
per `harness-check.ts`) and do NOT touch the guide (it already states the
intended design). Check whether the `EXEMPT_SCRIPTS` rationale comment in
`scripts/harness-check.ts:71-75` should now mention CI alongside full
verify; update the comment if so.

## Verify

```
bun run docs:lint-coverage-map:audit && bun run lint:config-sensors
```

## Acceptance

CI's coverage-map step runs the `:audit` form; `harness:check` stays
green; the audit passes at HEAD (it currently does under full verify).
