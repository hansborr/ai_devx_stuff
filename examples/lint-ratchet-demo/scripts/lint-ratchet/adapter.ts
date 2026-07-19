// The demo's whole binding to the portable engine, in one small module.
//
// This is the layer-4 "repo adapter" the slice plan describes: the only place
// the demo names its repository paths, its ratchet registry, and the engine
// context/binding the kernel operations receive as parameters. Everything the
// gate needs about "this repository" is assembled here from the package's pure
// primitives; the engine itself carries no demo bindings.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LintRatchetProposeEngine } from "@musi/lint-ratchet/governance/propose.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import {
  createLintRatchetEngineContext,
  type LintRatchetEngineBinding,
  type LintRatchetEngineContext,
} from "@musi/lint-ratchet/kernel/engine-context.js";

// scripts/lint-ratchet/adapter.ts -> ../.. is the demo root.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const BASELINE_FILENAME = "lint-ratchet.baseline.json";
const DEBT_LOG_FILENAME = "lint-ratchet.debt-log.jsonl";
export const baselinePath = join(repoRoot, BASELINE_FILENAME);

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
    repairKind: "manual",
    principle:
      "Routine console.log calls create noisy output; use an intentional console level or remove the diagnostic.",
  },
];

/**
 * The demo's concrete engine binding: the repo root the gate runs against plus
 * an empty third-party plugin allowlist (the demo ratchets one local rule, no
 * third-party plugins). Collection and rule-source hashing take this as a
 * parameter instead of importing repo-bound paths.
 */
export const demoBinding: LintRatchetEngineBinding = {
  repoRoot,
  thirdPartyPluginAllowlist: [],
};

/**
 * The demo's engine context: the resolved repo root and the committed
 * baseline/debt-log paths, derived through the package's own factory so the demo
 * exercises the same context construction an adopter would.
 */
export const demoContext: LintRatchetEngineContext = createLintRatchetEngineContext({
  repoRoot,
  baselineFilename: BASELINE_FILENAME,
  debtLogFilename: DEBT_LOG_FILENAME,
});

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
};
