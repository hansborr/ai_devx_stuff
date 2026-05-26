// @ts-check

import { defineConfig } from "eslint/config";

import { createBaseConfigs } from "./eslint-config/base-configs.js";
import {
  maxLinesExceptionConfigs,
  createRepoCodeQualityConfigs,
} from "./eslint-config/code-quality-configs.js";
import { jsonFileConfigs, createTsConfigFileConfigs } from "./eslint-config/config-file-configs.js";
import {
  clientFrameworkConfigs,
  clientRuntimeBoundaryConfigs,
} from "./eslint-config/client-configs.js";
import { localPlugin } from "./eslint-config/local-plugin.js";
import { createLocalRuleAuthoringConfigs } from "./eslint-config/local-rule-authoring-configs.js";
import {
  packagePolicyConfigs,
  rawTxClientBoundaryConfigs,
} from "./eslint-config/package-boundary-configs.js";
import { createPackageDependencyConfigs } from "./eslint-config/package-dependency-configs.js";
import {
  createScriptProjectConfigs,
  processPrimitiveConfigs,
  scriptDebtOverrideConfigs,
} from "./eslint-config/script-configs.js";
import { e2ePreferRoleSelectorAllowlist } from "./eslint-config/shared-policy.js";
import { createTestAndE2eConfigs, unitTestConfigs } from "./eslint-config/test-configs.js";

export { e2ePreferRoleSelectorAllowlist };

const repoRoot = import.meta.dirname;

export default defineConfig(
  ...createBaseConfigs(),
  ...createPackageDependencyConfigs(repoRoot),
  ...createRepoCodeQualityConfigs(repoRoot, localPlugin),
  ...createLocalRuleAuthoringConfigs(localPlugin),
  ...scriptDebtOverrideConfigs,
  ...processPrimitiveConfigs,
  ...clientFrameworkConfigs,
  ...jsonFileConfigs,

  // Keep high per-file caps and max-300 ratchet floor metadata in one policy.
  ...maxLinesExceptionConfigs,

  ...packagePolicyConfigs,
  ...createScriptProjectConfigs(repoRoot),
  ...createTestAndE2eConfigs(repoRoot),
  ...rawTxClientBoundaryConfigs,
  ...clientRuntimeBoundaryConfigs,
  ...createTsConfigFileConfigs(repoRoot),
  ...unitTestConfigs,
);
