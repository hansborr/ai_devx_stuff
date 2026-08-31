import type { CoverageEntry } from "./lint-coverage-map-manifest-schema.js";

export const productionPackageSourceEntries: readonly CoverageEntry[] = [
  {
    id: "packages-shared-src-ts",
    globs: ["packages/shared/src/**/*.ts"],
    pathNote: "(production)",
    files: "72 .ts",
    filesCountNote:
      "production only. The sibling shared-test row owns the rest of `packages/shared/src`, and rows carry no `ignores`, so this glob matches both halves. Narrowing it is a membership change, not a count fix.",
    normalLint: { covered: true },
    ratchets:
      "`local/max-lines` (default-cap subset), `ratchet/local-type-assertion-boundary`, `ratchet/max-depth-production`, `ratchet/max-lines-per-function-production`, `ratchet/strict-boolean-expressions-shared`",
    parser: "ESLint `type-aware-ts` (project service)",
    proposed:
      "none — shared-schema strictness, the `z.any()` fence, browser/framework restrictions, and the production-only scope-resolved Node ambient-global and module-reference fence cover the meaningful axes today",
    status: ["linted", "ratcheted"],
    followUp:
      "Tests and helpers retain Node access but remain subject to the browser and framework restrictions.",
  },
  {
    id: "packages-server-src-ts",
    globs: ["packages/server/src/**/*.ts"],
    pathNote: "(production, non-test)",
    files: "212 .ts",
    filesCountNote:
      "production, non-test only. The sibling server-test row owns the rest of `packages/server/src`, and rows carry no `ignores`, so this glob matches both halves.",
    normalLint: {
      covered: true,
      note: "including `local/no-plain-error-in-trpc` on routers/services except the upload-service REST boundary",
    },
    ratchets:
      "`local/max-lines` (default-cap subset, with named `warn` overrides for `routers/encounter.ts`, `routers/homebrew.ts`, `routers/srd.ts`, `services/rest-service.ts`), `ratchet/local-type-assertion-boundary`, `ratchet/max-depth-production`, `ratchet/max-lines-per-function-production`, `ratchet/strict-boolean-expressions-server-services` (services slice; encounter-combat is separately owned by `ratchet/strict-boolean-expressions-server-encounter-combat`)",
    parser: "ESLint `type-aware-ts` (project service)",
    proposed:
      "none — strict tier (server-only rules: `local/concurrency-guard`, `local/no-broadcast-in-transaction`, `local/no-outer-client-in-transaction`, `local/socket-registry-broadcasts`, `local/structured-logging`, `local/strict-trpc-input`, `local/no-plain-error-in-trpc`, tRPC schema rules, and shallow permissive-output restricted syntax) is the right family today",
    status: ["linted", "ratcheted"],
    followUp:
      "`packages/server/src/services/upload-service.ts` remains the documented REST-boundary exception; `routes/MODULE.md` maps its plain Errors to HTTP 400 outside tRPC.",
  },
  {
    id: "packages-server-src-prisma-concurrency-relation-graph-generated-json-ts",
    globs: ["packages/server/src/prisma/concurrency-relation-graph.generated.{json,ts}"],
    files: "1 .json + 1 .ts",
    normalLint: { covered: true },
    ratchets:
      "`ratchet/local-type-assertion-boundary`, `ratchet/max-depth-production`, `ratchet/max-lines-per-function-production` (generated .ts)",
    parser: "ESLint",
    proposed: "none",
    status: ["linted", "ratcheted"],
    followUp:
      "Generated together from the same schema/policy graph; JSON feeds the lint rule and typed ESM feeds the runtime guard.",
  },
  {
    id: "packages-client-src-ts-tsx",
    globs: ["packages/client/src/**/*.{ts,tsx}"],
    pathNote: "(production, non-test)",
    files: "389 .ts+.tsx",
    filesCountNote:
      "production, non-test only. The sibling client-test row owns the rest of `packages/client/src`, and rows carry no `ignores`, so this glob matches both halves.",
    normalLint: { covered: true },
    ratchets:
      "`local/max-lines` (default-cap subset, with named `warn` overrides for several form/encounter/notes/npc/pages/stores files), `ratchet/local-type-assertion-boundary`, `ratchet/max-depth-production`, `ratchet/max-lines-per-function-production`, `ratchet/react-hooks-set-state-in-effect-client`, `ratchet/react-refresh-only-export-components-client`",
    parser: "ESLint `type-aware-ts` (project service)",
    proposed:
      "none — strict tier plus React, jsx-a11y, `@tanstack/query`, hand-built query-key and `import.meta.env` restricted syntax, and the `local/no-effect-misuse` + `local/socket-listener-cleanup` pairing are the right family today",
    status: ["linted", "ratcheted"],
    followUp: "Normal lint is the sole `local/no-effect-misuse` floor for this scope.",
  },
  {
    id: "packages-server-prisma-seed-ts",
    globs: ["packages/server/prisma/seed.ts", "packages/server/prisma/seed-template.ts"],
    files: "2 .ts",
    normalLint: { covered: true, note: "server-scripts parser project" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json` parser project",
    proposed:
      "none — strict tier with `no-restricted-syntax` boundary allowlist for `process.exit`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "packages-server-prisma-schema-prisma",
    globs: ["packages/server/prisma/schema.prisma"],
    files: "1",
    normalLint: { covered: false },
    ratchets: "none",
    parser: "Prisma format",
    proposed: "`excluded` — Prisma schema is `prisma format`-managed, not an ESLint surface",
    status: ["excluded"],
    followUp: "Drift caught by `db:push`/migration workflow; no lint floor planned",
  },
  {
    id: "packages-server-prisma-migrations-sql",
    globs: ["packages/server/prisma/migrations/**/*.sql"],
    files: "20 .sql",
    normalLint: { covered: false },
    ratchets: "none",
    parser: "—",
    proposed: "`excluded` — append-only migrations, reviewed individually",
    status: ["excluded"],
    followUp: "—",
  },
  {
    id: "packages-server-prisma-migrations-migration-lock-toml",
    globs: ["packages/server/prisma/migrations/migration_lock.toml"],
    files: "1 .toml",
    normalLint: { covered: false },
    ratchets: "none",
    parser: "—",
    proposed: "`excluded` — Prisma-managed",
    status: ["excluded"],
    followUp: "—",
  },
  {
    id: "packages-server-prisma-migrations-safety-acknowledged",
    globs: ["packages/server/prisma/migrations/.safety-acknowledged"],
    files: "1",
    normalLint: { covered: false },
    ratchets: "none",
    parser: "—",
    proposed: "`excluded` — sentinel file for `migration-safety-scan.ts`",
    status: ["excluded"],
    followUp: "—",
  },
  {
    id: "packages-server-scripts-pgexec-ts",
    globs: ["packages/server/scripts/pgexec.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "server-scripts parser project" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `packages/server/tsconfig.scripts.json` parser project",
    proposed: "none — strict tier with `no-restricted-syntax` allowlist for `process.exit`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
];

export const packageTestEntries: readonly CoverageEntry[] = [
  {
    id: "packages-shared-src-test-spec-ts-tsx",
    globs: ["packages/shared/src/**/*.{test,spec}.{ts,tsx}", "packages/shared/src/**/test/**/*.ts"],
    files: "74 .ts",
    normalLint: {
      covered: true,
      note: "test-relaxed tier: `max-lines`, `no-magic-numbers`, `no-non-null-assertion`, `no-unsafe-return`, `no-unnecessary-type-assertion` off; vitest rules and `local/test-file-location` on",
    },
    ratchets: "`ratchet/local-type-assertion-boundary`, `ratchet/no-real-time-in-package-tests`",
    parser: "ESLint `type-aware-ts`",
    proposed: "none — vitest rule set plus the real-clock ratchet cover bug-class quality",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "packages-server-src-test-spec-ts-tsx",
    globs: [
      "packages/server/src/**/*.{test,spec}.{ts,tsx}",
      "packages/server/src/**/test/**/*.ts",
      "packages/server/src/**/__type-tests__/**/*.ts",
      "packages/server/src/**/**/*-test-helper.ts",
    ],
    files: "263 .ts",
    normalLint: { covered: true, note: "test-relaxed tier with vitest rules" },
    ratchets: "`ratchet/local-type-assertion-boundary`, `ratchet/no-real-time-in-package-tests`",
    parser: "ESLint `type-aware-ts`",
    proposed: "none",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "packages-client-src-test-spec-ts-tsx",
    globs: [
      "packages/client/src/**/*.{test,spec}.{ts,tsx}",
      "packages/client/src/**/test/**/*.{ts,tsx}",
      "packages/client/src/**/*.test-helper.*",
    ],
    files: "340 .ts+.tsx (213 .tsx + 127 .ts)",
    normalLint: {
      covered: true,
      note: "test-relaxed tier with vitest rules, plus `mock-trpc*` `promise-function-async` carve-out",
    },
    ratchets:
      "`ratchet/local-type-assertion-boundary`, `ratchet/no-real-time-in-package-tests` (named `mock-trpc.tsx` / fixtures get higher caps)",
    parser: "ESLint `type-aware-ts`",
    proposed: "none",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
];

export const endToEndTestEntries: readonly CoverageEntry[] = [
  {
    id: "e2e-ts",
    globs: ["e2e/**/*.ts"],
    pathNote: "(specs, page objects, helpers)",
    files: "50 .ts",
    normalLint: {
      covered: true,
      note: "Playwright recommended + custom Musi rules; selector rules are unconditional `error`",
    },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser:
      "ESLint `tsconfig.e2e.json` parser project, plus the `tsc -p tsconfig.e2e.json` lane in `scripts/typecheck.sh`",
    proposed: "none — Playwright rule set plus the Musi role-first rule are the right family today",
    status: ["linted", "ratcheted"],
    followUp:
      "`playwright/no-raw-locators` is left unconfigured because the local rule is stricter and carries Musi-specific guidance.",
  },
];
