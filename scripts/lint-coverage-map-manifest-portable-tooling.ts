import type { CoverageEntry } from "./lint-coverage-map-manifest-schema.js";

export const portableToolingEntries: readonly CoverageEntry[] = [
  {
    id: "tools-harness-diagnostics-src-ts",
    globs: ["tools/harness-diagnostics/src/**/*.ts"],
    files: "2 .ts (portable envelope schema and co-located contract test)",
    normalLint: { covered: true, note: "`tools/harness-diagnostics/**` reach block" },
    ratchets: "`ratchet/local-type-assertion-boundary` (zero floor)",
    parser: "ESLint `tools/harness-diagnostics/tsconfig.json` parser project",
    proposed:
      "none — package-owned Vitest project (`harness-diagnostics`) keeps the transport contract independently executable",
    status: ["linted", "ratcheted"],
    followUp:
      "Portable schema surface; source imports only its declared Zod dependency and the intentionally open tool-id contract remains adoption-owned.",
  },
  {
    id: "tools-harness-diagnostics-vitest-config-ts",
    globs: ["tools/harness-diagnostics/vitest.config.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "exact re-include from `**/*.config.*`" },
    ratchets: "none",
    parser: "typescript-eslint project service via `tsconfig.configs.json` default project",
    proposed: "strict-tier minus `local/max-lines`; the package Vitest project config",
    status: ["linted"],
    followUp: "Registered in `eslint-config/config-surface-manifest.json` (`root-package-ts`).",
  },
  {
    id: "tools-harness-diagnostics-package-json",
    globs: ["tools/harness-diagnostics/package.json", "tools/harness-diagnostics/tsconfig.json"],
    files: "2 .json",
    normalLint: { covered: true, note: "json/jsonc track" },
    ratchets: "none",
    parser: "—",
    proposed:
      "none — source-mapped schema package manifest and its composite tsconfig are structurally linted",
    status: ["linted"],
    followUp:
      "Package declares its Zod runtime dependency and is referenced from the root `tsconfig.json` build graph.",
  },
  {
    id: "tools-lint-ratchet-src-ts",
    globs: ["tools/lint-ratchet/src/**/*.ts"],
    files:
      "128 .ts (`kernel/` 73, `git-rail/` 19, `governance/` 36; co-located unit tests included)",
    normalLint: { covered: true, note: "`tools/lint-ratchet/**` reach block" },
    ratchets: "`ratchet/local-type-assertion-boundary` (zero floor)",
    parser: "ESLint `tools/lint-ratchet/tsconfig.json` parser project",
    proposed: "none — engine-zone `local/max-lines` cap (500)",
    status: ["linted", "ratcheted"],
    followUp:
      "Portable engine surface; relative and self-imports must resolve inside the package, and sibling Musi package imports are rejected by the package boundary test.",
  },
  {
    id: "tools-lint-ratchet-bin-ts",
    globs: ["tools/lint-ratchet/bin/**/*.ts"],
    files: "1 .ts (the installed git-rail binary wrapper)",
    normalLint: { covered: true, note: "`tools/lint-ratchet/**` reach block" },
    ratchets: "`ratchet/local-type-assertion-boundary` (zero floor)",
    parser: "ESLint `tools/lint-ratchet/tsconfig.json` parser project",
    proposed: "none — delegates directly to the package executable module",
    status: ["linted", "ratcheted"],
    followUp: "Package manifest `bin` target; the package-structure suite pins the exact mapping.",
  },
  {
    id: "tools-lint-ratchet-test-ts",
    globs: ["tools/lint-ratchet/test/**/*.ts"],
    files:
      "12 .ts (engine-context + package-structure suites, the non-Musi fixture-context acceptance test, the resolver-aware boundary checker + its unit test, and `test/support/` fixture helpers)",
    normalLint: { covered: true, note: "`tools/lint-ratchet/**` reach block" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tools/lint-ratchet/tsconfig.json` parser project",
    proposed:
      "none — package-owned Vitest project (`lint-ratchet`) with fail-closed boundary, exports-resolution, and non-Musi fixture-context assertions",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "tools-lint-ratchet-vitest-config-ts",
    globs: ["tools/lint-ratchet/vitest.config.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "exact re-include from `**/*.config.*`" },
    ratchets: "none",
    parser: "typescript-eslint project service via `tsconfig.configs.json` default project",
    proposed: "strict-tier minus `local/max-lines`; the package Vitest project config",
    status: ["linted"],
    followUp: "Registered in `eslint-config/config-surface-manifest.json` (`root-package-ts`).",
  },
  {
    id: "tools-lint-ratchet-package-json",
    globs: ["tools/lint-ratchet/package.json", "tools/lint-ratchet/tsconfig.json"],
    files: "2 .json",
    normalLint: { covered: true, note: "json/jsonc track" },
    ratchets: "none",
    parser: "—",
    proposed:
      "none — `@eslint/json` covers structural correctness; the package manifest and its composite tsconfig",
    status: ["linted"],
    followUp:
      "Package declares its own dependencies (source-only, no build); referenced from the root `tsconfig.json` build graph.",
  },
  {
    id: "tools-lint-ratchet-readme-md",
    globs: ["tools/lint-ratchet/README.md"],
    files: "1 .md",
    normalLint: { covered: false, note: "`*.md` not auto-formatted; not linted" },
    ratchets: "none",
    parser: "—",
    proposed: "`not-code` — package adoption/copyability doc",
    status: ["not-code"],
    followUp: "—",
  },
];
