# Lint Ratchet Registry Safe Default

Landed on 2026-05-25.

## Summary

Default `bun run lint:ratchet` now runs the full registry preflight before the
ESLint collection step. This gives local pre-commit and `verify:changed` the
same empty-glob, absolute-path, orphan-baseline, and registry-shape protection
as `bun run lint:ratchet:check-registry`, without adding a separate wrapper
slot.

`lint:ratchet:check-registry` keeps its dedicated OK/FAIL output, and
`lint:ratchet:update` still uses the existing update path so intentional
orphan-baseline drops can be handled with `--allow-worse --reason`.

## Verification

- `bash scripts/test-lint-ratchet.sh`
- `bun run test -- scripts/lint-ratchet-output.test.ts`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-registry`
- `bun run verify:changed`
