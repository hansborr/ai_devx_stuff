import type { CoverageEntry } from "./lint-coverage-map-manifest-schema.js";

export const driftAiRootEntries: readonly CoverageEntry[] = [
  {
    id: "scripts-drift-ai-entrypoint",
    globs: ["scripts/drift-ai.ts"],
    files: "1 .ts (entrypoint)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed:
      "none — normal lint enforces import sorting plus the family max-lines and complexity floors",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-drift-ai-test-ts",
    globs: ["scripts/drift-ai.test.ts"],
    files: "1 .ts",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets:
      "`ratchet/local-type-assertion-boundary`, `ratchet/vitest-expect-expect-drift-ai-tests`, `ratchet/vitest-valid-expect-drift-ai-tests`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed: "none — the Vitest bug-class rules have option-pinning ratchets",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
  {
    id: "scripts-test-support-tmp-repo-test-helper-ts",
    globs: ["scripts/test-support/tmp-repo.test-helper.ts"],
    files:
      "1 .ts (shared scripts tmp-repo scaffold: registerTempRootCleanup + writeRepo/makeTempRepo/writeRepoFile/makeTmpGitRepo)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed: "none",
    status: ["linted", "ratcheted"],
    followUp: "Shared by scripts tests that need temporary directories or Git repositories.",
  },
  {
    id: "scripts-benchmark-near-duplicates-ts",
    globs: [
      "scripts/benchmark-near-duplicates.ts",
      "scripts/benchmark-near-duplicates-core.ts",
      "scripts/benchmark-near-duplicates-core.test.ts",
      "scripts/benchmark-near-duplicates-cli.test.ts",
    ],
    files: "4 .ts (reproducible exact-tier wall/RSS benchmark and statistics)",
    normalLint: { covered: true, note: "`scripts/**/*.ts` default" },
    ratchets: "`ratchet/local-type-assertion-boundary`",
    parser: "ESLint `tsconfig.scripts.json`",
    proposed: "none — focused benchmark statistics tests plus live fuzzy/exact worker audit",
    status: ["linted", "ratcheted"],
    followUp:
      "Runs five fresh and five immediate-repeat processes per state, samples recursive process-tree RSS every 25 ms, and reports retain-the-slot timing plus exact bucket/baseline-growth evidence.",
  },
];

export const driftAiDirectChildEntries: readonly CoverageEntry[] = [
  {
    id: "scripts-drift-ai-direct-children",
    globs: ["scripts/drift-ai/*.ts"],
    derived: "drift-ai",
    normalLint: { covered: true },
    parser: "ESLint via `tsconfig.scripts.json`",
    proposed: "none — derived from tracked files, ESLint reach, and ratchet membership",
    status: ["linted", "ratcheted"],
    followUp: "—",
  },
];

export const driftAiFixtureEntries: readonly CoverageEntry[] = [
  {
    id: "scripts-drift-ai-fixtures-jscpd-report-basic-json",
    globs: [
      "scripts/drift-ai/fixtures/jscpd-report.basic.json",
      "scripts/drift-ai/fixtures/knip-report.unused-exports.json",
      "scripts/drift-ai/fixtures/knip-report.duplicates.json",
    ],
    files: "3 .json",
    normalLint: {
      covered: false,
      note: "JSON lint ignores via targeted `scripts/drift-ai/fixtures/**`",
    },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — fixtures (`knip-report.unused-exports.json` and `knip-report.duplicates.json` are captured verbatim from knip 6.14.1 JSON reporter output for the relevant categories)",
    status: ["excluded"],
    followUp: "—",
  },
  {
    id: "scripts-drift-ai-fixtures-unused-exports-knip-report-json",
    globs: ["scripts/drift-ai/fixtures/unused-exports/knip-report.json"],
    files: "1 .json",
    normalLint: {
      covered: false,
      note: "JSON lint ignores via targeted `scripts/drift-ai/fixtures/**`",
    },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — synthetic knip `--reporter json` fixture whose `exports` reference the `fixtures/coverage/**` source paths, consumed by `coverage-unused-correlation-command.test.ts`; never live code",
    status: ["excluded"],
    followUp: "—",
  },
  {
    id: "scripts-drift-ai-fixtures-report-contract-json",
    globs: ["scripts/drift-ai/fixtures/report-contract.*.json"],
    files: "4 .json (`clean`, `clean.with-scope`, `findings`, `findings.with-scope`)",
    normalLint: {
      covered: false,
      note: "JSON lint ignores via targeted `scripts/drift-ai/fixtures/**`",
    },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — golden portable `--format json` report contract fixtures byte-compared by `report-contract.test.ts`; never live code",
    status: ["excluded"],
    followUp: "—",
  },
  {
    id: "scripts-drift-ai-fixtures-dolos-report-csv",
    globs: ["scripts/drift-ai/fixtures/dolos-report/*.csv"],
    files: "3 .csv",
    normalLint: { covered: false },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — Dolos clone-report CSV fixtures consumed by drift-ai tests; never live code",
    status: ["excluded"],
    followUp: "—",
  },
  {
    id: "scripts-drift-ai-fixtures-clone-corpus",
    globs: ["scripts/drift-ai/fixtures/clone-corpus/**"],
    files: "8 .ts + 1 .json (labeled clone-detection benchmark corpus)",
    normalLint: {
      covered: false,
      note: "targeted `scripts/drift-ai/fixtures/**` ignore, matching `tsconfig.scripts.json` and knip project-graph exclusions",
    },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — synthesized labeled clone/non-clone fixtures plus the machine-readable `labels.json`, consumed by `clone-corpus.test.ts`; never live code",
    status: ["excluded"],
    followUp: "Engine-agnostic ground truth for comparing clone engines before promotion.",
  },
  {
    id: "scripts-drift-ai-fixtures-near-duplicates-v2",
    globs: ["scripts/drift-ai/fixtures/near-duplicates-v2/**"],
    files: "6 .ts + 1 .json (C3 exact-function, repeated-block, and precision-trap corpus)",
    normalLint: {
      covered: false,
      note: "targeted `scripts/drift-ai/fixtures/**` ignore, matching `tsconfig.scripts.json`",
    },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — executable-looking detector inputs and manifest consumed by focused clone-tier tests; never live code",
    status: ["excluded"],
    followUp:
      "Pins the calibrated jscpd eight-statement advisory acceptance and exact-token/tier precision boundaries.",
  },
  {
    id: "scripts-drift-ai-fixtures-dead-code-corpus",
    globs: ["scripts/drift-ai/fixtures/dead-code-corpus/**"],
    files: "12 .ts + 1 .tsx + 1 .json (labeled dead-code false-positive trap corpus)",
    normalLint: {
      covered: false,
      note: "targeted `scripts/drift-ai/fixtures/**` ignore, matching `tsconfig.scripts.json`",
    },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — synthetic barrel, dynamic-import, test-only, framework-entrypoint, reflection/string-keyed, and known-unused fixtures plus machine-readable labels, consumed by `dead-code-corpus.test.ts`; never live code",
    status: ["excluded"],
    followUp:
      "Ground truth for calibrating coverage/reachability, sibling naming, and class-construction prototype rows before promotion.",
  },
  {
    id: "scripts-drift-ai-fixtures-semgrep",
    globs: ["scripts/drift-ai/fixtures/semgrep/**"],
    files:
      "2 .json + 1 .yml (real Semgrep scan capture, a synthetic metadata-rich variant, and the smoke rule that produced the capture)",
    normalLint: {
      covered: false,
      note: "the drift-ai fixtures dir is re-excluded in `eslint.config.js`; the `.yml` is outside the maintained YAML config surfaces",
    },
    ratchets: "none",
    parser: "—",
    proposed:
      "`excluded` — path-sanitized Semgrep 1.165.0 logged-out `--json` capture over `scripts/drift-ai`, the capture-shaped `scan-output.synthetic-rich.json` (rich rule metadata, `errors[]`, `skipped_rules`), and the first-party throwaway rule; consumed by `semgrep-output.test.ts` / `semgrep-runner.test.ts`, never live code",
    status: ["excluded"],
    followUp:
      "Reproduction commands live in `docs/agent_notes/backlog/semgrep-drift-ai-implementation-plan.md`; the engine venv under `.tools/` is per-checkout and gitignored.",
  },
  {
    id: "scripts-drift-ai-readme-md",
    globs: ["scripts/drift-ai/README.md"],
    files: "1 .md",
    normalLint: { covered: false, note: "`docs:lint-coverage-map` treats Markdown as docs" },
    ratchets: "none",
    parser: "—",
    proposed:
      "`not-code` — portable operator entry point (quickstart plus the authoritative check/flag/subcommand tables) that travels with the tool",
    status: ["not-code"],
    followUp: "—",
  },
  {
    id: "scripts-drift-ai-docs-md",
    globs: ["scripts/drift-ai/docs/*.md"],
    files: "7 .md",
    normalLint: { covered: false, note: "`docs:lint-coverage-map` treats Markdown as docs" },
    ratchets: "none",
    parser: "—",
    proposed:
      "`not-code` — focused audience docs split out of the portable README (prototype lane, check reference, portability contract, supported subcommands, Musi integration)",
    status: ["not-code"],
    followUp: "—",
  },
];
