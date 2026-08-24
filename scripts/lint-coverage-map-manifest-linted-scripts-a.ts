import type { CoverageEntry } from "./lint-coverage-map-manifest-schema.js";

export const lintedScriptEntriesA: readonly CoverageEntry[] = [
  {
    id: "scripts-client-test-isolation-classifier-ts",
    globs: [
      "scripts/client-test-isolation-classifier.ts",
      "scripts/client-test-isolation-classifier-source.ts",
      "scripts/client-test-isolation-classifier-types.ts",
      "scripts/client-test-isolation-classifier.test.ts",
      "scripts/client-test-isolation-runner.ts",
      "scripts/client-test-isolation-runner.test.ts",
    ],
    files: "6 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — focused classifier/runner coverage pins the generated client isolation buckets and lane invocation",
    status: ["linted", "ratcheted"],
    followUp:
      "Supports split client Vitest lanes; unit tests cover comments, strings, `vi.mocked`, aliases, discovery, JSON CLI output, generated lane args, empty-bucket skips, and coverage rejection.",
  },
  {
    id: "scripts-vitest-worker-count-ts",
    globs: ["scripts/vitest-worker-count.ts", "scripts/vitest-worker-count.test.ts"],
    files: "2 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — focused coverage pins the shared group-0 cap and positive-integer environment override",
    status: ["linted", "ratcheted"],
    followUp:
      "Keeps client, shared, scripts, and eslint-rules on the identical `maxWorkers` value Vitest requires within one sequence group.",
  },
  {
    id: "scripts-drift-triage-ts",
    globs: [
      "scripts/drift-triage.ts",
      "scripts/drift-triage/drift-triage-options.ts",
      "scripts/drift-triage/drift-triage-inputs.ts",
      "scripts/drift-triage/drift-triage-packet-io.ts",
      "scripts/drift-triage/drift-triage-collect.ts",
      "scripts/drift-triage/drift-triage.test.ts",
      "scripts/drift-triage/drift-triage-collect.test.ts",
    ],
    files: "7 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — report-only CLI with focused parsing, packet output, verdict collection, and failure-path coverage",
    status: ["linted", "ratcheted"],
    followUp:
      "Compacts drift/advisory JSON into deterministic swarm packets, then validates and collects partial agent verdicts with retry accounting.",
  },
  {
    id: "scripts-check-local-eslint-rule-starter-ts",
    globs: [
      "scripts/check-local-eslint-rule-starter.ts",
      "scripts/check-local-eslint-rule-starter.test.ts",
    ],
    files: "2 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — extracts and exercises the four-file standalone starter in `docs/guides/local-eslint-rules.md` without network installation",
    status: ["linted", "ratcheted"],
    followUp: "Whole-tree verify/CI guard; intentionally omitted from the changed gate.",
  },
  {
    id: "scripts-adr-check-ts",
    globs: [
      "scripts/adr-check.ts",
      "scripts/adr-check-parse.ts",
      "scripts/adr-check-locators.ts",
      "scripts/adr-check.test.ts",
    ],
    files: "4 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — narrow ADR parser, structural gate locators, reverse-reference scan, and focused fixture coverage",
    status: ["linted", "ratcheted"],
    followUp:
      "`adr:check` validates accepted architecture decisions against their real enforcing sources without a separate gate registry.",
  },
  {
    id: "scripts-code-intel-facade",
    globs: ["scripts/code-intel.ts"],
    files: "1 .ts (CLI entrypoint)",
    normalLint: { covered: true },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed: "none",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-import-closure",
    globs: [
      "scripts/import-closure/closure-walk.ts",
      "scripts/import-closure/closure-walk.test.ts",
      "scripts/import-closure/alias-parity.test.ts",
      "scripts/import-closure/runtime-imports.ts",
      "scripts/import-closure/runtime-imports.test.ts",
      "scripts/import-closure/runtime-resolution.ts",
    ],
    files: "6 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "focused Vitest coverage plus the worktree DB fingerprint gate on every seed fingerprint",
    status: ["linted", "ratcheted"],
    followUp:
      "Recursively derives repository-local static ESM closures for seed fingerprinting and bounded fixture copy-set checks; the source policy is a coarse fail-closed token scan (CommonJS loaders, non-static specifiers, and unnamed environment reads are errors).",
  },
  {
    id: "scripts-worktree-db-naming-constants-test-ts",
    globs: ["scripts/worktree-db-naming-constants.test.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "focused scripts-project coverage pins shell producer bounds and alphabets to the destructive TypeScript allowlist",
    status: ["linted", "ratcheted"],
    followUp:
      "Prevents worktree database naming drift from widening or narrowing destructive test-database guards unnoticed.",
  },
  {
    id: "scripts-lint-probe-rule-ts",
    globs: ["scripts/lint-probe-rule.ts", "scripts/lint-probe-rule.test.ts"],
    files: "2 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — focused unit coverage pins argument parsing and ratchet writer reuse; `scripts/tests/test-lint-probe-rule.sh` exercises the single-local-rule probe command against real ESLint stdin",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-lint-message-eval-ts",
    globs: [
      "scripts/lint-message-eval.ts",
      "scripts/lint-message-eval.test.ts",
      "scripts/lint-message-eval/evaluator.ts",
      "scripts/lint-message-eval/reporter.ts",
      "scripts/lint-message-eval/trace.ts",
    ],
    files: "5 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — focused coverage replays treatment/control traces, pins message freshness, and classifies stuck, oscillating, and cascading repairs",
    status: ["linted", "ratcheted"],
    followUp: "Manual/scheduled report lane; see `docs/guides/lint-message-evals.md`.",
  },
  {
    id: "scripts-backlog-lint-ts",
    globs: [
      "scripts/backlog-lint.ts",
      "scripts/backlog-lint-core.ts",
      "scripts/backlog-lint-format.ts",
      "scripts/backlog-lint-types.ts",
      "scripts/backlog-lint-metadata.ts",
      "scripts/backlog-lint-status.ts",
      "scripts/backlog-lint-packs.ts",
      "scripts/backlog-lint-index-table.ts",
      "scripts/backlog-lint-drift.ts",
      "scripts/backlog-lint.test.ts",
      "scripts/backlog-lint-packs.test.ts",
      "scripts/backlog-lint-drift.test.ts",
    ],
    files: "12 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — report-only backlog metadata + pack-index lint with focused parser and stale-note coverage",
    status: ["linted", "ratcheted"],
    followUp:
      "`bun run backlog:lint` checks `docs/agent_notes/backlog/**/*.md` without becoming a gate.",
  },
  {
    id: "scripts-audit-dependency-licenses-ts",
    globs: [
      "scripts/audit-dependency-licenses.ts",
      "scripts/audit-dependency-licenses-core.ts",
      "scripts/audit-dependency-licenses-classification.test.ts",
      "scripts/audit-dependency-licenses-command.test.ts",
    ],
    files: "4 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — focused public-release dependency license audit CLI, covered by normal script lint",
    status: ["linted", "ratcheted"],
    followUp:
      "Audits the production dependency closure for strong copyleft, review-only copyleft, and unknown license metadata before MIT publication.",
  },
  {
    id: "scripts-code-intel-modules",
    globs: ["scripts/code-intel/**/*.ts"],
    files: "56 .ts (incl. 19 `.test.ts` suites and `test-fixtures.test-helper.ts`)",
    normalLint: { covered: true },
    ratchets:
      "`ratchet/local-type-assertion-boundary`; tests also use `ratchet/vitest-expect-expect-script-tests`, `ratchet/vitest-valid-expect-script-tests`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — strict tier applies and the suites are co-located with the modules they cover",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-code-intel-server-ts",
    globs: ["scripts/code-intel-server.ts"],
    files: "1 .ts",
    normalLint: { covered: true },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed: "none",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
];
