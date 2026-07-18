import type { JsonValue, LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";

import {
  aggregateNormalLintStatus,
  matchingTrackedFiles,
  type NormalLintFloorStatus,
  type NormalLintStatusForFile,
} from "./zero-baseline.js";

// The scope of an orphaned (registry-removed) ratchet, taken from its committed
// baseline test entry. Enough to probe normal-lint coverage for the retire path
// without reconstructing the full registry config: parser profile and source do
// not affect ESLint's resolved-config severity lookup for an already-linted file.
export interface OrphanRetireScope {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
}

export interface OrphanPromotionProof {
  readonly normalError: boolean;
  readonly matchedFileCount: number;
  readonly normalLintStatus: NormalLintFloorStatus;
  readonly matchedFiles: readonly string[];
}

function probeConfig(scope: OrphanRetireScope): LintRatchetConfig {
  return {
    id: scope.id,
    ruleId: scope.ruleId,
    files: scope.files,
    ignores: scope.ignores,
    ruleOptions: scope.ruleOptions,
    mode: "no-new",
    metric: "message-count",
    repairKind: "manual",
    // Placeholder only: this probe config feeds normal-lint coverage matching;
    // principle is the harness-controls doc field and never read on this path.
    principle: "retire-path probe (principle unused)",
  };
}

// Prove a removed ratchet's guard was actually replaced before letting
// --retire-ratchet skip --allow-worse + the debt log: every matched tracked file
// must resolve the same rule/options at error under normal lint. An empty scope
// is never proof — a zero baseline alone could just mean the ratchet matched no
// files, not that normal lint took over.
export async function proveOrphanPromotedToNormalError(
  scope: OrphanRetireScope,
  trackedFiles: readonly string[],
  statusForFile: NormalLintStatusForFile,
  acceptDifferentOptions = false,
): Promise<OrphanPromotionProof> {
  const probe = probeConfig(scope);
  const matchedFiles = matchingTrackedFiles(probe, trackedFiles);
  const fileStatuses = await Promise.all(
    matchedFiles.map(async (path) => statusForFile(probe, path)),
  );
  const normalLintStatus = aggregateNormalLintStatus(fileStatuses);
  return {
    normalError:
      matchedFiles.length > 0 &&
      (normalLintStatus === "normal-error" ||
        (acceptDifferentOptions && normalLintStatus === "normal-error-different-options")),
    matchedFileCount: matchedFiles.length,
    normalLintStatus,
    matchedFiles,
  };
}
