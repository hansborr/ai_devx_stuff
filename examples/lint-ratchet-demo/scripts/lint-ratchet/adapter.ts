// The demo's whole binding to the portable engine, in one small module.
//
// This is the layer-4 "repo adapter" the slice plan describes: the only place
// the demo names its repository paths, its ratchet registry, and the engine
// context/binding the kernel operations receive as parameters. Everything the
// gate needs about "this repository" is assembled here from the package's pure
// primitives; the engine itself carries no demo bindings.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LintRatchetProposeEngine } from "@musi/lint-ratchet/governance/propose.js";
import type { LintRatchetGitRailAdapter } from "@musi/lint-ratchet/git-rail/executable-config.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import {
  createLintRatchetEngineContext,
  type LintRatchetEngineBinding,
  type LintRatchetEngineContext,
  type LintRatchetWorkflowVocabulary,
} from "@musi/lint-ratchet/kernel/engine-context.js";

// scripts/lint-ratchet/adapter.ts -> ../.. is the demo root.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const baselineFilename = "lint-ratchet.baseline.json";
const debtLogFilename = "lint-ratchet.debt-log.jsonl";

/**
 * The demo's tiny registry: one demo-authored, repository-neutral local rule,
 * ratcheted on the demo's own `src/`. A real adopter grows this list; the shape
 * is the same {@link LintRatchetConfig} the Musi registry uses, proving the
 * engine takes any registry the adapter hands it.
 */
export const demoRatchets: readonly LintRatchetConfig[] = [
  {
    id: "ratchet/no-console-src",
    ruleId: "local/no-console-log",
    files: ["src/**/*.ts"],
    ignores: ["**/dist/**", "**/node_modules/**"],
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    principle:
      "Routine console.log calls create noisy output; use an intentional console level or remove the diagnostic.",
  },
];

/**
 * The demo's concrete engine binding: the repo root the gate runs against plus
 * an empty third-party plugin allowlist (the demo ratchets one local rule, no
 * third-party plugins). The omitted optional directory fields retain the
 * portable defaults (`eslint-rules` and `node_modules/.cache/eslint-ratchet`);
 * adopters may set repository-relative alternatives here. Collection and
 * rule-source hashing take this as a parameter instead of importing repo-bound
 * paths.
 */
export const demoBinding: LintRatchetEngineBinding = {
  repoRoot,
  thirdPartyPluginAllowlist: [],
};

export const demoWorkflowVocabulary: LintRatchetWorkflowVocabulary = {
  updateCommand: "bun run lint:ratchet:update",
  regressionUpdateCommand:
    'bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this debt beats a rushed fix>"',
  debtAcceptanceCommand:
    'bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this debt beats a rushed fix>"',
  installMergeDriverCommand: "bun run lint:ratchet:install-merge-driver",
  restoreBaselineOursCommand: (baselineFile) =>
    `bun run baseline:restore-stage -- --ours ${baselineFile}`,
  trendAllCommand: "bun run lint:ratchet:trend -- --all",
};

/**
 * The demo's engine context: the resolved repo root and the committed
 * baseline/debt-log paths, derived through the package's own factory so the demo
 * exercises the same context construction an adopter would.
 */
export const demoContext: LintRatchetEngineContext = createLintRatchetEngineContext({
  repoRoot,
  baselineFilename,
  debtLogFilename,
  workflowVocabulary: demoWorkflowVocabulary,
});

export const lintRatchetGitRailAdapter: LintRatchetGitRailAdapter = {
  baselineFile: baselineFilename,
  debtLogFile: debtLogFilename,
  executableModuleSpecifier: "@musi/lint-ratchet/git-rail/executable-cli.js",
  checkBaselineCommand: ["bun", "run", "lint:ratchet:check-baseline"],
  worseBaselineExitCode: 1,
  workflowVocabulary: demoWorkflowVocabulary,
  binding: demoBinding,
  ratchets: demoRatchets,
};

/**
 * The demo's propose engine. `registryHint` names where the preview tells the
 * reader to paste a promotable config — this demo's registry lives in this very
 * file, so the hint points here. This is the injected hint S4 made an adapter
 * concern (the package never names a registry location itself).
 */
export const demoProposeEngine: LintRatchetProposeEngine = {
  repoRoot,
  binding: demoBinding,
  registryHint: "scripts/lint-ratchet/adapter.ts",
  workflowVocabulary: demoWorkflowVocabulary,
};
