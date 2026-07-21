# Dependency Age-Gated Follow-ups

Status: Done — implemented and verified 2026-07-20 on `auto/ready-b-deps21`
Date: 2026-05-28

## Why Parked

The May 2026 dependency refresh intentionally avoided package versions published
less than seven days before the audit. `bunfig.toml` now enforces the same
policy with `install.minimumReleaseAge = 604800`.

This is a cleanup pass, not a migration. Keep it separate from major upgrades.

## Known Candidates

The 2026-05-27 audit flagged these fresh latest tags as deferred by the age
gate. Rerun registry checks before promoting because this list is time-sensitive:

- TanStack latest tags for Query/Router/plugin packages.
- `ioredis` 5.11.0.
- `@vitest/eslint-plugin` 1.6.18.
- `jscpd` 4.2.4.
- `knip` 6.14.2.
- `typescript-eslint` 8.60.0.
- `vite` 8.0.14.
- `@eslint-community/eslint-plugin-eslint-comments` 4.7.2.

## Plan

1. Rerun `bun outdated` and, if needed, registry publish-date checks for any
   package still hidden by the age gate.
2. Apply only same-major patch/minor updates that have cleared the seven-day
   policy.
3. Keep this pass dependency-only unless refreshed types expose a small local
   cleanup.
4. Regenerate `bun.lock` with `bun install`.
5. Leave major migrations to the dedicated backlog notes.

## Verification

- `bun install --frozen-lockfile`
- `bun run audit:deps`
- `bun run typecheck`
- `bun run lint`
- `bun run test:changed`
- `bun run verify:changed`

If touched packages affect build tooling, run `bun run build` as well.
