# Ratchet Adopter Quickstart

Status: Parked
Order: 29

## Context

`docs/guides/lint-ratchet.md` is thorough but long. Reference readers need a
short path to adding one ratchet before reading the whole guide.

## Scope

- Add a short "First ratchet in 10 minutes" section near the top of the
  ratchet guide.
- Include the minimum copy set, one core-rule registry entry, and the commands
  `lint:ratchet:check-registry`, `lint:ratchet:update`, and `lint:ratchet`.
- Link to the portable test-set guidance if `27-ratchet-test-portability.md`
  has landed; otherwise leave a clear TODO pointer.

## Definition Of Done

A new adopter can add one simple ratchet before reading the whole guide.

## Verification

- `bunx prettier --check --ignore-unknown docs/guides/lint-ratchet.md`
- Any doc generation/check command affected by the guide
