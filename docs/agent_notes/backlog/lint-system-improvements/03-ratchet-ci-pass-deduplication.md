# Ratchet CI Pass Deduplication

Status: Parked
Order: 3

## Context

The source review found CI running:

```sh
bun run lint:ratchet:check-registry
bun run lint:ratchet
bun run lint:ratchet:check-baseline
bun run lint:ratchet:zero-baseline
```

Default `lint:ratchet` already runs registry preflight and compares current
findings against the committed baseline. `check-baseline` recollects current
findings and compares again, so CI may be paying for a redundant heavy ESLint
pass.

## Scope

- Re-audit current `lint:ratchet` command behavior, CI wiring, and ratchet
  smoke tests.
- Keep `lint:ratchet:check-registry` only if the separate CI label is valuable.
- Keep `lint:ratchet` as the primary baseline comparison gate.
- Keep `lint:ratchet:zero-baseline` as the lifecycle gate.
- Either remove `lint:ratchet:check-baseline` from CI or change it into a
  structural/no-ESLint validation step.
- Preserve ratchet diagnostics artifacts and sticky comment behavior.

## Definition Of Done

CI keeps the ratchet safety properties while avoiding redundant full ESLint
collection passes unless a measured reason remains.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:zero-baseline`
- `bun run test:scripts:changed` or focused ratchet smoke tests
- Successful CI validate run with ratchet report/comment output intact
