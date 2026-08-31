import type { CoverageEntry } from "./lint-coverage-map-manifest-schema.js";

export const topLevelScriptEntrypointEntries: readonly CoverageEntry[] = [
  {
    id: "scripts-db-status-ts",
    globs: ["scripts/db-status.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets:
      "`ratchet/local-type-assertion-boundary` (also named in `eslint.config.js` `no-restricted-syntax` allowlist for the `process.env` and `process.exit` carve-outs)",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-harness-emit-envelope-ts",
    globs: ["scripts/harness-emit-envelope.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-sensor-blob-size-ts",
    globs: ["scripts/sensor-blob-size.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-sensor-blob-size-test-ts",
    globs: ["scripts/sensor-blob-size.test.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-sensor-context-budget-ts",
    globs: ["scripts/sensor-context-budget.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-sensor-context-budget-test-ts",
    globs: ["scripts/sensor-context-budget.test.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-mutation-survivors-ts",
    globs: [
      "scripts/mutation-survivors.ts",
      "scripts/mutation-survivors.test.ts",
      "scripts/lib/mutation-survivors-summary.ts",
    ],
    files: "3 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-mutation-targets-ts",
    globs: [
      "scripts/mutation-targets.ts",
      "scripts/mutation-targets.test.ts",
      "scripts/lib/mutation-targets.ts",
    ],
    files: "3 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint pins `restrict-template-expressions` `allowNumber: false`",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-sensor-knip-unused-exports-ts",
    globs: [
      "scripts/sensor-knip-unused-exports.ts",
      "scripts/sensor-knip-unused-exports-core.ts",
      "scripts/sensor-knip-unused-exports-baseline.ts",
      "scripts/sensor-knip-unused-exports.test.ts",
      "scripts/sensor-knip-unused-exports-merge-cli.ts",
      "scripts/sensor-knip-unused-exports-merge-cli.test.ts",
    ],
    files:
      "6 .ts (knip unused-export identity floor CLI, identity spec/collector/gate on the baseline framework, runner integration, semantic merge CLI, and focused tests)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed:
      "none — normal script lint plus the committed identity baseline cover the promoted sensor surface",
    status: ["linted", "ratcheted"],
    followUp:
      "Only the unused-export identity floor is promoted; raw knip and duplicate/jscpd reports remain advisory.",
  },
  {
    id: "scripts-sensor-near-duplicates-ts",
    globs: [
      "scripts/sensor-near-duplicates.ts",
      "scripts/sensor-near-duplicates-core.ts",
      "scripts/sensor-near-duplicates-cli-options.ts",
      "scripts/sensor-near-duplicates-cli-options.test.ts",
      "scripts/sensor-near-duplicates-baseline.ts",
      "scripts/sensor-near-duplicates-baseline-gate.ts",
      "scripts/sensor-near-duplicates-baseline-io.ts",
      "scripts/sensor-near-duplicates-merge-cli.ts",
      "scripts/sensor-near-duplicates-merge-cli.test.ts",
      "scripts/sensor-near-duplicates.test.ts",
    ],
    files:
      "10 .ts (changed-file near-clone gate plus its baseline-gate suite, reasoned admission CLI plus its parser characterization tests, HEAD-anchored shrink-only pair-identity baseline, semantic merge CLI, and focused merge coverage)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets:
      "`ratchet/local-type-assertion-boundary`; merge test also uses the script-test Vitest floors",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed:
      "none — normal script lint plus the fixture-backed gate test and committed identity baseline cover the promoted sensor",
    status: ["linted", "ratcheted"],
    followUp:
      "Only pairs touching staged files are gated; the whole-repo `drift:ai --check near-duplicates` report remains advisory.",
  },
  {
    id: "scripts-suppression-ledger-ts",
    globs: [
      "scripts/suppression-ledger.ts",
      "scripts/suppression-ledger-core.ts",
      "scripts/suppression-ledger-baseline.ts",
      "scripts/suppression-ledger-identity.ts",
      "scripts/suppression-ledger-emission.ts",
      "scripts/suppression-ledger-runner.ts",
      "scripts/suppression-ledger-core.test.ts",
      "scripts/suppression-ledger-baseline.test.ts",
      "scripts/suppression-ledger-identity.test.ts",
      "scripts/suppression-ledger-emission.test.ts",
    ],
    files:
      "10 .ts (suppression identity ledger CLI, gate/update flow, identity-ledger spec on the baseline framework, line-free identity derivation, register identity-emission parser, register spawn runner, and focused tests)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal script lint plus the committed identity ledger cover the surface",
    status: ["linted", "ratcheted"],
    followUp:
      "The ledger records identity and trend over inline suppressions; suppression policy stays in `scripts/{eslint-disable,suppression}-register.sh` and their two data allowlists.",
  },
  {
    id: "scripts-baseline-merge-cli-table-ts",
    globs: [
      "scripts/baseline-merge-cli-table.ts",
      "scripts/baseline-merge-cli-table.test.ts",
      "scripts/baseline-family-parity.test.ts",
    ],
    files:
      "3 .ts (merge-CLI data table + derivation wrapper, with focused table and cross-surface family parity coverage)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed:
      "none — focused tests pin the derived CLI strings and enforce explicit per-family metadata parity across the hand-authored shell and TypeScript surfaces",
    status: ["linted", "ratcheted"],
    followUp:
      "The table serves the three Musi-owned semantic-merge CLIs; the parity gate separately models package-owned lint-ratchet so its deliberately absent repository surfaces cannot regrow.",
  },
  {
    id: "scripts-lib-baseline-single-group-spec-test-ts",
    globs: [
      "scripts/lib/baseline/single-group-spec.test.ts",
      "scripts/lib/baseline/read-entries.ts",
    ],
    files:
      "2 .ts (adapter test for the `single-group-spec` kernel over Musi sensor specs, plus the shared `parseBaseline` entry unwrap)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal script lint covers them",
    status: ["linted", "ratcheted"],
    followUp:
      "The kernel source lives in `@musi/lint-ratchet`; the Musi sensor-spec test stays adapter-side and every sensor reader delegates to `read-entries.ts`.",
  },
  {
    id: "scripts-max-lines-exceptions-ts",
    globs: [
      "scripts/max-lines-exceptions.ts",
      "scripts/max-lines-exceptions-core.ts",
      "scripts/max-lines-effective-lines.ts",
      "scripts/max-lines-exceptions.test.ts",
      "scripts/max-lines-exceptions-merge-cli.ts",
      "scripts/max-lines-exceptions-merge-cli.test.ts",
    ],
    files:
      "6 .ts (max-lines per-file cap exceptions baseline on the framework: spec/format/count-aware gate + `--check`/`--update` CLI, effective-line audit through the ESLint rule, semantic merge CLI, and focused tests)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal script lint plus the committed exceptions baseline cover the surface",
    status: ["linted", "ratcheted"],
    followUp:
      "`eslint-config/max-lines-exceptions.baseline.json` owns the exception data and `max-lines-policy.js` reads it fail-loud.",
  },
  {
    id: "scripts-git-baseline-info-attributes-ts",
    globs: ["scripts/git/baseline-info-attributes.ts"],
    files:
      "1 .ts (thin CLI wrapper for the .git/info/attributes managed-block renderer; reads/writes files and delegates to the package op)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal script lint covers it",
    status: ["linted", "ratcheted"],
    followUp:
      "The pure renderer and unit test live in `@musi/lint-ratchet/git-rail/info-attributes`; this wrapper preserves the installed drivers' invoked path.",
  },
  {
    id: "scripts-data-eslint-disable-broad-allowlist-txt",
    globs: [
      "scripts/data/eslint-disable-broad-allowlist.txt",
      "scripts/data/ts-nocheck-allowlist.txt",
    ],
    files: "2 .txt",
    normalLint: { covered: false },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — line-based suppression waiver inventories consumed fail-loud by their register scripts",
    status: ["excluded"],
    followUp:
      "Changes trigger full suppression-register scans so allowlist shrinkage checks unchanged source files.",
  },
  {
    id: "scripts-devcontainer-contract-test-ts",
    globs: ["scripts/devcontainer-contract.test.ts"],
    files:
      "1 .ts (guards the `.devcontainer/` startup and prerequisite contract, and the test-DB bootstrap SQL both Compose stacks share, against Dockerfile/compose drift)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint covers this top-level scripts test",
    status: ["linted", "ratcheted"],
    followUp:
      "Keeps the README Prerequisites section, the single server-start path, and the single-sourced test-DB bootstrap SQL pinned to the files they restate.",
  },
  {
    id: "scripts-devcontainer-env-example-test-ts",
    globs: ["scripts/devcontainer-env-example.test.ts"],
    files:
      "1 .ts (guards `.devcontainer/.env.example` JWT_SECRET length against `env.ts` `MIN_JWT_SECRET_LENGTH`)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint covers this top-level scripts test",
    status: ["linted", "ratcheted"],
    followUp:
      "Pairs the devcontainer template with the enforced minimum so they cannot silently diverge.",
  },
  {
    id: "scripts-e2e-tsconfig-resolution-test-ts",
    globs: ["scripts/e2e-tsconfig-resolution.test.ts"],
    files: "1 .ts (guards `tsconfig.e2e.json` `paths` against the gitignored package `dist/`)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint via `tsconfig.scripts.json` parser override",
    proposed: "none — normal lint covers this top-level scripts test",
    status: ["linted", "ratcheted"],
    followUp:
      "The e2e typecheck lane runs concurrently with `tsc -b`, so workspace imports must resolve to source on both cold and warm trees.",
  },
];
