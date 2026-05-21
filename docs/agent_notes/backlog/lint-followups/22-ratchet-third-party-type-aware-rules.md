# Leaf 22: Third-Party And Type-Aware Ratchet Support

Status: Resolved 2026-05-19 — third-party and type-aware ratchet support
landed; `typescript-eslint` is allowlisted and type-aware ratchets bypass the
ESLint cache.
Sources:

- `scripts/lint-ratchet.ts`
- `scripts/lint-ratchet-config.ts`
- `docs/guides/lint-ratchet.md`
- `docs/agent_notes/backlog/lint-followups/01-ratchet-cache-invalidation.md`
- `docs/agent_notes/backlog/lint-followups/04-ratchet-runtime-budget.md`

## Problem

`lint:ratchet` originally supported repo-local rules only. Leaf 22 added
explicit third-party plugin sources with parser profiles and deterministic
plugin/cache identity. This note remains provenance for that support. Leaf 23
then used the new path for
`@typescript-eslint/strict-boolean-expressions` and drained the shared baseline
to 0 current findings.

## Historical Scope

Extend the ratchet runner so a ratchet registry entry can describe either:

- a local rule module from `eslint-rules/*.js`, or
- a supported third-party plugin rule with explicit plugin import, parser
  options, and deterministic cache identity.

Do not make this a generic "load arbitrary ESLint config" escape hatch. Each
new rule source should be explicit enough for baseline validation, cache
invalidation, harness controls, and smoke tests to prove what is being run.

## Historical Candidate Work

- Add a registry shape for rule source, plugin import, and parser/profile
  requirements.
- Preserve the current local-rule path and its rule-implementation hash.
- Add cache identity coverage for third-party package version, rule options,
  parser profile, files, ignores, and any generated config content.
- Support a type-aware parser profile for package TypeScript files without
  accidentally linting generated, dist, or ignored paths.
- Add shell and/or fixture coverage for:
  - unsupported rule namespace failure,
  - supported third-party rule execution,
  - type-aware parser configuration,
  - baseline check/update behavior, and
  - deterministic generated config/cache paths.
- Update `docs/guides/lint-ratchet.md`, `harness.controls.json`, and generated
  harness docs if the ratchet model changes.

## Historical Exit Criteria

- A third-party rule can be ratcheted without weakening the local-rule
  ratchet.
- Type-aware ratchets have deterministic cache/config identity.
- Unsupported plugins still fail loudly rather than silently producing an
  incomplete ratchet.
- Runtime impact is measured or explicitly bounded before any type-aware
  ratchet is added to pre-commit.

## Verification

- `bash scripts/test-lint-ratchet.sh`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run test:scripts:changed`
- `bun run lint`
