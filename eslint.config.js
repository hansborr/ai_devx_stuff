// @ts-check

import { defineConfig } from "eslint/config";

import { createBaseConfigs } from "./eslint-config/base-configs.js";
import {
  maxLinesEngineZoneConfigs,
  maxLinesExceptionConfigs,
  maxLinesGeneratedExemptionConfigs,
  createRepoCodeQualityConfigs,
} from "./eslint-config/code-quality-configs.js";
import { jsonFileConfigs, createTsConfigFileConfigs } from "./eslint-config/config-file-configs.js";
import {
  clientFrameworkConfigs,
  clientRuntimeBoundaryConfigs,
} from "./eslint-config/client-configs.js";
import { localPlugin } from "./eslint-config/local-plugin.generated.js";
import { createLocalRuleAuthoringConfigs } from "./eslint-config/local-rule-authoring-configs.js";
import {
  packagePolicyConfigs,
  rawTxClientBoundaryConfigs,
} from "./eslint-config/package-boundary-configs.js";
import { createPackageDependencyConfigs } from "./eslint-config/package-dependency-configs.js";
import { restrictedSyntaxConfigs } from "./eslint-config/restricted-syntax-policy.js";
import {
  createScriptProjectConfigs,
  driftDirectionLawConfigs,
  scriptDebtOverrideConfigs,
} from "./eslint-config/script-configs.js";
import { createToolsProjectConfigs } from "./eslint-config/tools-configs.js";
import {
  productionFunctionStructureFiles,
  productionFunctionStructureIgnores,
} from "./eslint-config/path-glob-policy.js";
import { createTestAndE2eConfigs, unitTestConfigs } from "./eslint-config/test-configs.js";

const repoRoot = import.meta.dirname;
const lintAgentStructuralConfigs =
  globalThis.process.env.MUSI_LINT_AGENT_STRUCTURAL_OVERLAY === "1"
    ? [
        {
          name: "musi/lint-agent-structural-overlays",
          files: productionFunctionStructureFiles,
          ignores: productionFunctionStructureIgnores,
          rules: {
            // Match the no-new production ratchets. Warnings keep accepted
            // baseline debt advisory in the envelope while changed files get
            // the same structured finding named by the ratchet hook.
            "max-depth": ["warn", { max: 3 }],
            "max-lines-per-function": [
              "warn",
              { max: 100, skipBlankLines: true, skipComments: true },
            ],
          },
        },
      ]
    : [];

export default defineConfig(
  ...createBaseConfigs(),
  ...createPackageDependencyConfigs(repoRoot),
  ...createRepoCodeQualityConfigs(repoRoot, localPlugin),
  ...createLocalRuleAuthoringConfigs(localPlugin),
  ...scriptDebtOverrideConfigs,
  ...driftDirectionLawConfigs,
  // The whole no-restricted-syntax policy, composed additively from
  // eslint-config/restricted-syntax-policy.js. No other config group sets this
  // rule key, so nothing can clobber a fence by landing after it.
  ...restrictedSyntaxConfigs,
  ...clientFrameworkConfigs,
  ...jsonFileConfigs,

  // Raise the max-lines floor to 500 for the lint-ratchet engine zone before
  // the per-file caps below, so engine files consolidate at real seams while
  // genuine >500 outliers still resolve to their per-file exception entry.
  ...maxLinesEngineZoneConfigs,

  // Keep high per-file caps and max-300 ratchet floor metadata in one policy.
  ...maxLinesExceptionConfigs,

  // Turn the per-file cap off for generator-owned files (explicit,
  // guard-verified allowlist); spread after the caps so `off` wins.
  ...maxLinesGeneratedExemptionConfigs,

  ...packagePolicyConfigs,
  ...createScriptProjectConfigs(repoRoot),
  ...createToolsProjectConfigs(repoRoot),
  ...createTestAndE2eConfigs(repoRoot),
  ...rawTxClientBoundaryConfigs,
  ...clientRuntimeBoundaryConfigs,
  ...createTsConfigFileConfigs(repoRoot),
  ...unitTestConfigs,
  ...lintAgentStructuralConfigs,
);
