# Dependency refresh 2026-05

Task: compare current workspace package versions against npm registry versions and update safely where practical.

Policy:
- Current date: 2026-05-27 UTC.
- Avoid dependency versions published less than seven days ago unless there is a compelling reason.
- Prefer same-major patch/minor updates for this pass; flag larger migrations separately.
- `bunfig.toml` now sets `install.minimumReleaseAge = 604800` so future Bun installs use the same age gate.

Status:
- Registry audit complete.
- Safe same-major refresh applied to manifests and lockfile.
- `fast-uri` is pinned through a root `overrides` entry at 3.1.2 to clear the current high-severity audit finding while upstream dependency chains still pin 3.1.0.
- Prisma client regenerated after the Prisma 7.8.0 bump.
- Review cleanup fixed the dashboard test `Link` mock for campaign params and updated the SRD procedure-helper comment after the list-return casts were removed.
- Verification at this stopping point:
  - `bun run typecheck` passed.
  - `bun run lint` passed.
  - `bun run test` passed sequentially (`7423` tests / `517` files). A concurrent run had one timeout in `eslint-rules/max-lines-policy.test.js`; the isolated rerun and sequential full run passed.
  - `bun run audit:deps` passed after the `fast-uri` override.
  - `bun run build` passed.
  - `bun run format:changed:check` passed.
  - Review reruns: `bun run test:client -- packages/client/src/pages/dashboard-page.test.tsx`, `bun run test:server -- packages/server/src/utils/srd-query-helpers.test.ts`, `bun install --frozen-lockfile`, and `bun run audit:deps` passed.
  - Final first-commit gate after ratchet metadata refresh: `bun run verify:changed` passed.

Applied package groups:
- Client/runtime: TanStack Query/Router safe candidates, tRPC 11.17.0, React/React DOM 19.2.6, Konva/React Konva, lucide-react, tailwind-merge, Zustand.
- Server/runtime: Fastify patch/minor plugins except multipart major, Prisma 7.8.0 set, tRPC 11.17.0, Fastify 5.8.5, jose, pg, Zod.
- Tooling: Playwright 1.60.0, TypeScript 5.9.3, typescript-eslint 8.59.4, Vitest/Coverage 4.1.7, Tailwind/Vite safe candidates, Prettier, Knip, jscpd, React hooks/Playwright ESLint plugins.

Deferred by policy:
- Fresh latest tags: TanStack latest tags after the age cutoff, `ioredis` 5.11.0, `@vitest/eslint-plugin` 1.6.18, `jscpd` 4.2.4, `knip` 6.14.2, `typescript-eslint` 8.60.0, `vite` 8.0.14, `@eslint-community/eslint-plugin-eslint-comments` 4.7.2.
- Major/non-compatible upgrades: ESLint 10.x and `@eslint/js` 10.x, TypeScript 6.x, `@fastify/multipart` 10.x, `eslint-plugin-jsdoc` 63.x, `@types/node` 25.x.

Recommended next phases:
1. Safe refresh landed in commit `b87cb51e`.
2. Deferred upgrade backlog notes:
   - `docs/agent_notes/backlog/ready-2026-07/10-dependency-age-gated-followups.md`
   - ESLint 10 / `@eslint/js` 10: **landed (Phase A) 2026-05-28** — see `../LOG.md`;
     jsdoc 63 remains as Phase B below.
   - `docs/agent_notes/backlog/ready-2026-07/06-typescript-6-upgrade.md`
   - `docs/agent_notes/backlog/ready-2026-07/07-fastify-multipart-10-upgrade.md`
   - `docs/agent_notes/backlog/ready-2026-07/08-eslint-plugin-jsdoc-63-upgrade.md`
   - `docs/agent_notes/backlog/ready-2026-07/09-node-types-25-upgrade.md`

Migration-tool research notes:
- ESLint v10 docs mention `eslint-transforms v9-rule-migration` for custom rule/plugin migration and `@eslint/compat` compatibility patches.
- Fastify documents codemod recipes for framework major migrations, but no obvious `@fastify/multipart` 10-specific codemod was found.
- TypeScript 6 release notes mention some toolable adjustments, but no single official whole-repo codemod was found for this codebase.
