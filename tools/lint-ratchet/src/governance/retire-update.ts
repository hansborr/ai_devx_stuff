import { existsSync, readFileSync } from "node:fs";

import { ESLint } from "eslint";

import {
  type LintRatchetRetireRequest,
  parseLintRatchetBaselineStructure,
} from "../kernel/baseline.js";
import { isJsonValue, isRecord } from "../kernel/baseline-hash.js";
import type { JsonValue, LintRatchetConfig } from "../kernel/config-types.js";
import { type LintRatchetEngineContext, relativeToRepoRoot } from "../kernel/engine-context.js";
import { trackedFilesFromGit } from "../kernel/git-tracked-files.js";
import { ConfigError } from "../kernel/metrics-types.js";
import {
  type OrphanRetireScope,
  proveOrphanPromotedToNormalError,
} from "./retire-promotion-proof.js";
import { createNormalLintStatusForFile } from "./zero-baseline.js";

function orphanScope(
  context: LintRatchetEngineContext,
  retireRatchetId: string,
  registry: readonly LintRatchetConfig[],
): OrphanRetireScope | undefined {
  if (registry.some((ratchet) => ratchet.id === retireRatchetId)) return undefined;
  if (!existsSync(context.baselinePath)) {
    throw new ConfigError(
      `${relativeToRepoRoot(context.repoRoot, context.baselinePath)} does not exist; run ${context.workflowVocabulary.updateCommand}`,
    );
  }
  const parsed = parseLintRatchetBaselineStructure(
    readFileSync(context.baselinePath, "utf8"),
    context.workflowVocabulary,
    undefined,
    relativeToRepoRoot(context.repoRoot, context.baselinePath),
  );
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
  context: LintRatchetEngineContext,
  retireRatchetId: string,
  registry: readonly LintRatchetConfig[],
  options: { readonly acceptDifferentOptions?: boolean; readonly reason?: string } = {},
): Promise<LintRatchetRetireRequest> {
  const scope = orphanScope(context, retireRatchetId, registry);
  if (scope === undefined) return { id: retireRatchetId, normalErrorProven: false };
  const eslint = new ESLint({ cwd: context.repoRoot });
  const statusForFile = createNormalLintStatusForFile(eslint);
  const proof = await proveOrphanPromotedToNormalError(
    scope,
    trackedFilesFromGit("proving lint-ratchet retirement promotion", context.repoRoot),
    statusForFile,
    options.acceptDifferentOptions,
  );
  if (
    proof.normalLintStatus !== "normal-error-different-options" ||
    options.acceptDifferentOptions !== true ||
    !proof.normalError
  ) {
    return { id: retireRatchetId, normalErrorProven: proof.normalError };
  }
  const reason = options.reason?.trim();
  if (reason === undefined || reason.length === 0) {
    throw new ConfigError("different-options retirement requires a non-empty attestation reason");
  }
  const normalLintOptions = await collectNormalLintOptions(eslint, scope, proof.matchedFiles);
  console.error(
    `Retirement options attestation for ${retireRatchetId}: ratchet=${JSON.stringify(scope.ruleOptions)}; normal lint=${JSON.stringify(normalLintOptions)}; reason=${reason}`,
  );
  return {
    id: retireRatchetId,
    normalErrorProven: true,
    optionsAttestation: {
      reason,
      ratchetOptions: scope.ruleOptions,
      normalLintOptions,
    },
  };
}

function optionsFromConfig(config: unknown, ruleId: string): readonly JsonValue[] | undefined {
  if (!isRecord(config) || !isRecord(config.rules)) return undefined;
  const rule = config.rules[ruleId];
  if (!Array.isArray(rule)) return [];
  const options = rule.slice(1);
  return options.every((option) => isJsonValue(option)) ? options : undefined;
}

async function collectNormalLintOptions(
  eslint: ESLint,
  scope: OrphanRetireScope,
  matchedFiles: readonly string[],
): Promise<readonly (readonly JsonValue[])[]> {
  const byIdentity = new Map<string, readonly JsonValue[]>();
  for (const path of matchedFiles) {
    const options = optionsFromConfig(await eslint.calculateConfigForFile(path), scope.ruleId);
    if (options === undefined) {
      throw new ConfigError(
        `could not serialize normal-lint options for ${scope.ruleId} on ${path}`,
      );
    }
    byIdentity.set(JSON.stringify(options), options);
  }
  return [...byIdentity.values()];
}
