# Leaf 1: Zero-Warning Lint Gate

Status: Landed
Depends on: none
Blocks: most new ESLint hardening

## Landed 2026-05-16

The zero-warning gate landed for both `bun run lint` and
`bun run lint:changed`. The 102-warning baseline was resolved by treating the
prepared-spell arrays as SRD reference-table data, moving the two targeted
`local/max-lines` overrides to modest `error` caps, and updating
`lint-changed` smoke coverage for the new warning gate.

## Problem

Musi has warning-severity ESLint rules, but `bun run lint` and
`bun run lint:changed` do not fail on warnings. Long-lived warnings therefore
become manual visibility pressure instead of a deterministic gate.

## Current Baseline

A 2026-05-16 probe with `bun run lint -- --max-warnings=0` found 102 warnings:

- 100 `no-magic-numbers` warnings in prepared-spell reference tables in
  `packages/shared/src/rules/spellcasting.ts`.
- One `local/max-lines` warning in
  `packages/shared/src/rules/attack-damage.ts`.
- One `local/max-lines` warning in
  `packages/client/src/test/mock-trpc.tsx`.

The baseline looks tractable, but the real scope depends on which stable
warning-severity rules are promoted to `error`.

## Candidate Work

- Extend the existing `no-magic-numbers` reference-table exception in
  `spellcasting.ts` to cover prepared-spell tables, or replace values with
  named constants only if that improves readability.
- Resolve the two `local/max-lines` warnings by splitting files or adjusting
  targeted caps to modest error caps with the existing explanatory comments.
- Convert stable warning rules to `error` where the project wants enforcement,
  especially `no-console`, `no-magic-numbers`, naming conventions, React hooks,
  and targeted max-lines overrides.
- Add `--max-warnings=0` to `bun run lint` and `bun run lint:changed` only
  after the baseline is clean, unless every remaining warning-severity rule has
  intentionally become an error.
- For future experiments, use report-only commands or JSON diagnostics instead
  of ESLint `warn`.

## Rollout Notes

After this lands, `warn` should mean "temporary migration pressure with a named
follow-up", not a normal contributor outcome.

Do not combine this leaf with a new lint plugin or new local rule. The point is
to make current lint behavior deterministic before expanding lint surface.

This leaf unlocks most later ESLint hardening: after it lands, future leaves can
use `bun run lint -- --max-warnings=0` as a clean adoption gate instead of
arguing about whether `warn` is visible enough.

## Verification

- `bun run lint -- --max-warnings=0` while iterating on the baseline.
- `bun run lint`
- `bun run lint:changed`
- `bun run verify:changed`
- `bun run vitest run --project=eslint-rules` if changing local rule behavior.
