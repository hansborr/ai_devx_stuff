# Lint Platform Positioning

Status: Done
Order: 19

## Context

The source review recommends explicitly framing Musi's setup as a lint
platform, not just an ESLint config. The platform includes ESLint config
modules, local rules, ratchet runtime, coverage map, generated harness
documentation, verify/pre-commit/CI orchestration, and agent adapters.

Reference adopters need to know what they can copy minimally and what requires
ongoing ownership.

## Outcome

Added `docs/guides/lint-ratchet-adoption.md` with two explicit tiers:

- **Tier 1 — Minimal ratchet:** registry + baseline + gate. Lists every file to
  copy, what to change, the portable test set, and ongoing ownership cost.
- **Tier 2 — Full platform:** adds coverage map, agent envelope, post-edit
  hooks, CI reporting, and custom guidance pipeline. Lists additional pieces and
  additional ownership cost.

Also includes a "What is not portable" section naming Musi-specific pieces that
should not be copied verbatim, and a decision guide for choosing between tiers.

Updated `docs/guides/lint-ratchet.md` to point adopters at the new guide before
the full reference.

## Definition Of Done

Reference readers can understand the lint setup as a platform with clear
minimal and full adoption paths, including the ownership cost of copying the
full system.

## Verification

- `bun run format:changed:check`
- `bun run docs:lint-coverage-map:check` if coverage-map docs change
- `bun run verify:changed` if scripts or generated docs change
