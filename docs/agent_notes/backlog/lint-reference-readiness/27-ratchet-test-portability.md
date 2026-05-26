# Ratchet Test Portability

Status: Parked
Order: 27

## Context

The ratchet runtime has focused tests, including
`lint-ratchet-baseline.test.ts` and `lint-ratchet-check-registry.test.ts`, but
the reference copy story does not say whether those tests travel with the
ratchet files or which tests are Musi-specific.

## Scope

- Identify the minimum ratchet test set an adopter should copy.
- Run or fixture-scope those tests so they pass without unrelated Musi app
  state.
- Document any tests that intentionally remain Musi-only.

## Definition Of Done

The ratchet guide names the portable test set, and that set passes in
isolation or in a documented fixture.

## Verification

- Portable ratchet test command
- `bun run test:scripts:changed`
- `bun run verify:changed`
