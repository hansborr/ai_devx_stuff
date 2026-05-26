# Lint Platform Positioning

Status: Parked
Order: 19

## Context

The source review recommends explicitly framing Musi's setup as a lint
platform, not just an ESLint config. The platform includes ESLint config
modules, local rules, ratchet runtime, coverage map, generated harness
documentation, verify/pre-commit/CI orchestration, and agent adapters.

Reference adopters need to know what they can copy minimally and what requires
ongoing ownership.

## Scope

- Re-audit `docs/guides/lint-ratchet.md`, generated lint docs, local-rule docs,
  and backlog notes for adopter-facing gaps.
- Add or update authored guidance that presents two adoption paths:
  - Minimal: ESLint config plus selected local rules.
  - Full: ratchet, coverage map, harness controls, hooks, and CI reporting.
- Make ownership boundaries explicit: path policy, allowlists, ratchet
  lifecycle, external tool provisioning, generated docs, and hook adapters.
- Keep Musi-specific implementation backlog detail out of adopter docs.

## Definition Of Done

Reference readers can understand the lint setup as a platform with clear
minimal and full adoption paths, including the ownership cost of copying the
full system.

## Verification

- `bun run format:changed:check`
- `bun run docs:lint-coverage-map:check` if coverage-map docs change
- `bun run verify:changed` if scripts or generated docs change
