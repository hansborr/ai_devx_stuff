import { existsSync, readFileSync } from "node:fs";

import { ESLint } from "eslint";

import { trackedFilesFromGit } from "./git-tracked-files.js";
import {
  type LintRatchetRetireRequest,
  parseLintRatchetBaselineStructure,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { createNormalLintStatusForFile } from "./lint-ratchet-zero-baseline.js";
import { BASELINE_FILENAME, baselinePath, repoRoot } from "./paths.js";
import {
  type OrphanRetireScope,
  proveOrphanPromotedToNormalError,
} from "./retire-promotion-proof.js";

function orphanScope(
  retireRatchetId: string,
  registry: readonly LintRatchetConfig[],
): OrphanRetireScope | undefined {
  if (registry.some((ratchet) => ratchet.id === retireRatchetId)) return undefined;
  if (!existsSync(baselinePath)) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`);
  }
  const parsed = parseLintRatchetBaselineStructure(readFileSync(baselinePath, "utf8"));
  const test = parsed.baseline?.tests[retireRatchetId];
  if (test === undefined) return undefined;
  return {
    id: retireRatchetId,
    ruleId: test.ruleId,
    files: test.files,
    ignores: test.ignores,
    ruleOptions: test.ruleOptions,
  };
}

// Build the --retire-ratchet request the decision/apply path consumes: prove the
// removed ratchet's guard is now enforced by normal lint at error on its
// recorded scope. When the id is still registered or absent from the baseline,
// no proof is attempted — the decision layer then emits the precise failure
// (e.g. "not an orphaned baseline entry").
export async function resolveRetireRequest(
  retireRatchetId: string,
  registry: readonly LintRatchetConfig[],
): Promise<LintRatchetRetireRequest> {
  const scope = orphanScope(retireRatchetId, registry);
  if (scope === undefined) return { id: retireRatchetId, normalErrorProven: false };
  const eslint = new ESLint({ cwd: repoRoot });
  const statusForFile = createNormalLintStatusForFile(eslint);
  const proof = await proveOrphanPromotedToNormalError(
    scope,
    trackedFilesFromGit("proving lint-ratchet retirement promotion"),
    statusForFile,
  );
  return { id: retireRatchetId, normalErrorProven: proof.normalError };
}
