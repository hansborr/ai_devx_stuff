# Leaf 7: Knip Unused-Export Structural Sensor

Status: Landed sweep (2026-05-17); 161 findings triaged with delete-unless-justified default.
Depends on: none, but pairs with Leaf 18 (structural sensors)

## Problem

ESLint catches unused imports inside a file but cannot detect:

- Exports that no one imports across the workspace.
- Files that no one imports.
- Dependencies declared in `package.json` that no source file uses.

This is exactly the surface where AI agents produce dead code: a helper file
that duplicates an existing utility, a freshly-added export no caller wires
up, or a `package.json` dependency added during exploratory work and never
removed.

Musi already has `local/no-barrel` to prevent re-export sprawl, and
`bun run code:intel -- dependents` to ask "who imports X". Neither generates
a workspace-wide report.

## Decision

Run [`knip`](https://knip.dev) as a structural sensor (not as ESLint). Keep
it report-only first, then promote.

This leaf is intentionally earlier than the rest of the structural-sensor
cluster. Its inventory can clear dead helpers, orphan files, and unused
dependencies before scripts coverage and type-assertion hardening expand their
lint surface.

This is a sensor, not an ESLint rule, because:

- Workspace-wide scans are slow and unsuitable for `--cache` ESLint runs.
- The failure mode is "delete code", which is a separate human decision per
  finding rather than a per-file fix.

## Rollout

1. Install `knip` as a devDependency.
2. Generate `knip.config.ts` for the monorepo: explicitly mark each
   package's entry points (Vite client, Fastify server, shared barrel
   exceptions, scripts).
3. Run as inventory; expect many findings.
4. Triage:
   - True dead code: delete.
   - Intentional public exports (e.g., used by tests only, or re-exported
     for documentation): annotate in `knip.config.ts`.
   - Plugin/loader-detected dynamic imports: configure knip plugin (Vite,
     Vitest, Playwright, Prisma).
5. Add `bun run sensor:knip` script. Wire into `doctor` first, not into
   `verify:changed`.
6. Decide later whether `verify` (full) should fail on knip findings, or
   stay report-only.

## Open Questions

- Some Musi code uses dynamic import for code-splitting client routes. Verify
  knip's React/TanStack Router plugin coverage before declaring those
  unreferenced.
- Prisma's generated client and seed scripts need explicit entry points.

## Verification

- `bun run sensor:knip` once added.
- `bun run test:scripts:changed` for any script wrapper.
- `bun run doctor` if knip is folded into doctor output.
- If knip stays report-only, is deferred after inventory, or lands with
  notable caveats/allowlists, append a row to `evaluation-verdicts.md`.

## Implementation Result

Landed on 2026-05-16 with knip 6.12.2 as a report-only sensor.

- Config layout: one root `knip.config.ts` with root-owned entries for
  scripts, e2e, ESLint rules, GitHub Actions, Husky, and package workspaces
  for client, server, and shared.
- Plugin coverage: root uses Bun, ESLint, GitHub Actions, Husky, Playwright,
  Prettier, Stryker, TypeScript, and Vitest; client uses Vite, Vitest,
  TypeScript, TanStack Router, and Tailwind; server uses Prisma, TypeScript,
  and Vitest; shared uses TypeScript and Vitest.
- Config carve-outs: shared `src/schemas/**` and `src/rules/**` exports/types
  are treated as the shared contract surface; client `components/ui/**`
  exports are treated as the shadcn-style component surface; server
  `src/utils/__type-tests__/*.ts` and `src/seed/generate-*.ts` are explicit
  entries.
- Dependency false positives: `@prisma/client`, `jscpd`, and `pino-pretty`
  are ignored in `ignoreDependencies` with comments explaining their generated,
  binary, and string-target usage.
- Deleted: `@tanstack/react-router-devtools` from
  `packages/client/package.json` and `@types/bcryptjs` from
  `packages/server/package.json`; `bcryptjs` 3.0.3 ships its own types.
- Deferred at Pass 2: broad unused-export and unused-exported-type cleanup.
  This was resolved by the Leaf 7b sweep result below.
- Wiring: root `sensor:knip` runs `knip --no-progress`; `doctor` runs it
  report-only and records nonzero knip exits as `WARN`, not `FAIL`.

## Sweep Result

Leaf 7b landed on 2026-05-17.

- Total findings triaged: 161 knip export/type findings, plus the 2
  commitlint dependency metadata findings.
- Export/type disposition: 5 deleted, 41 carved out as intentional surface,
  115 changed from exported to module-private.
- Dependency fixes: `@commitlint/cli` is ignored because Husky invokes it via
  `bunx commitlint`; `@commitlint/types` is declared because
  `commitlint.config.js` imports its JSDoc config type.

Per-package breakdown:

- `e2e`: 3 carved out.
- `packages/client`: 56 triaged — 1 deleted, 16 carved out, 39 unexported.
- `packages/server`: 30 triaged — 4 deleted, 1 carved out, 25 unexported.
- `packages/shared`: 21 carved out.
- `scripts`: 51 unexported.

New `ignoreIssues` carve-outs:

- `packages/shared/src/map/**`: VTT map layer schemas/types are shared
  contract surface, matching `schemas/**` and `rules/**`.
- `packages/client/src/components/homebrew/*/*-form-fields.tsx`: entity form
  modules document `FormData` re-exports as public editor entry points.
- `packages/client/src/test/fixtures-srd.ts`: reusable SRD fixture builders.
- `packages/client/src/test/fixtures-encounter.ts`: reusable encounter fixture
  builders.
- `packages/server/src/test/fixtures.ts`: reusable server fixture factories.
- `e2e/helpers/**`: reusable Playwright API/data helpers.

## References

- [knip](https://knip.dev)
