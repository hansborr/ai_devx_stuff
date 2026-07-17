# 10 — `worktree:new` breaks on new template fingerprints

Status: Done
Track: T (tooling) · Priority: P1 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The complete fresh-worktree chain was verified and reproduced in all five isolated Codex lanes. The paved `bun run dev` path is also affected because its shared prebuild runs after `worktree:init`.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/worktree-new.sh:180-182` — `worktree:new` delegates to initialization and reports a misleading port/Redis-pool hint on failure.
- `scripts/worktree-db.sh:975` — dependency preparation runs `bun install` and Prisma generation but does not build shared output before template refresh.
- `scripts/worktree-db.sh:663` — template refresh invokes `seed-template.ts`.
- `packages/server/prisma/seed-srd-monsters.ts:4` — the seed imports `@musi/shared/rules/conditions.js`, whose package export resolves to absent `dist` output in a fresh worktree.
- `scripts/dev.sh:247` and `scripts/dev.sh:250` — shared prebuild exists, but runs after worktree initialization.

Failure: A new template fingerprint makes `worktree:new` and fresh-worktree `bun run dev` fail before the advertised provisioning path can complete.

## Do

Build the shared package in `cmd_init` before template refresh, or add an exact dist preflight that directs the caller to the required build. Keep the fix in the shared initialization path so both entry points benefit.

## Verify

```
bash scripts/tests/test-worktree-db.sh && bash scripts/tests/test-worktree-new.sh
```

## Acceptance

- A fresh worktree with no shared `dist` can initialize a refreshed template.
- Failure guidance identifies missing shared output rather than blaming port or Redis exhaustion.
