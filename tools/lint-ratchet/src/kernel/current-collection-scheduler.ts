import type { LintRatchetRuleSourceHashesById } from "./baseline.js";
import type { LintRatchetConfig } from "./config-types.js";
import type { LintRatchetEngineBinding } from "./engine-context.js";
import type { ESLintFileResult } from "./eslint-runner.js";
import { runEslintForFiles, sweepStaleCacheSiblings } from "./eslint-runner.js";
import { ConfigError } from "./metrics-types.js";
import { matchingTrackedFiles } from "./ratchet-globs.js";
import { ratchetParserProfile } from "./runtime-config.js";

export type RatchetEslintCollectionResult = {
  readonly id: string;
  readonly ratchet: LintRatchetConfig;
  readonly results: readonly ESLintFileResult[];
};

function isTypeAwareRatchet(ratchet: LintRatchetConfig): boolean {
  return ratchetParserProfile(ratchet) === "type-aware-ts";
}

function nextRunnableRatchetIndex(
  ratchets: readonly LintRatchetConfig[],
  started: ReadonlySet<number>,
  typeAwareInFlight: number,
): number | undefined {
  for (let ratchetIndex = 0; ratchetIndex < ratchets.length; ratchetIndex += 1) {
    if (started.has(ratchetIndex)) continue;
    const ratchet = ratchets[ratchetIndex];
    if (ratchet === undefined) continue;
    if (typeAwareInFlight > 0 && isTypeAwareRatchet(ratchet)) continue;
    return ratchetIndex;
  }
  return undefined;
}

async function collectRatchet(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
  trackedFiles: readonly string[],
  binding: LintRatchetEngineBinding,
): Promise<RatchetEslintCollectionResult> {
  const files = matchingTrackedFiles(ratchet, trackedFiles);
  sweepStaleCacheSiblings(ratchet, ruleSourceHash, binding.repoRoot);
  try {
    return {
      id: ratchet.id,
      ratchet,
      results: await runEslintForFiles(ratchet, ruleSourceHash, files, binding),
    };
  } finally {
    sweepStaleCacheSiblings(ratchet, ruleSourceHash, binding.repoRoot);
  }
}

function rejectWithError(rejectResults: (reason?: unknown) => void, error: unknown): void {
  rejectResults(error instanceof Error ? error : new Error(String(error)));
}

export interface CollectRatchetsInput {
  readonly limit: number;
  readonly trackedFiles: readonly string[];
  readonly binding: LintRatchetEngineBinding;
}

export async function collectRatchets(
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  input: CollectRatchetsInput,
): Promise<readonly (RatchetEslintCollectionResult | undefined)[]> {
  const { limit, trackedFiles, binding } = input;
  const results: Array<RatchetEslintCollectionResult | undefined> = [];
  const started = new Set<number>();
  let active = 0;
  let completed = 0;
  let typeAwareInFlight = 0;

  return await new Promise((resolveResults, rejectResults) => {
    let rejected = false;

    function pump(): void {
      if (rejected) return;
      if (completed === ratchets.length) {
        resolveResults(results);
        return;
      }
      while (active < limit) {
        const ratchetIndex = nextRunnableRatchetIndex(ratchets, started, typeAwareInFlight);
        if (ratchetIndex === undefined) return;
        const ratchet = ratchets[ratchetIndex];
        if (ratchet === undefined) continue;
        const ruleSourceHash = ruleSourceHashesById.get(ratchet.id);
        if (ruleSourceHash === undefined) {
          rejected = true;
          rejectResults(
            new ConfigError(`lint:ratchet: missing rule source hash for ${ratchet.id}`),
          );
          return;
        }

        const typeAware = isTypeAwareRatchet(ratchet);
        started.add(ratchetIndex);
        active += 1;
        if (typeAware) typeAwareInFlight += 1;
        void collectRatchet(ratchet, ruleSourceHash, trackedFiles, binding).then(
          (result) => {
            results[ratchetIndex] = result;
            active -= 1;
            completed += 1;
            if (typeAware) typeAwareInFlight -= 1;
            pump();
          },
          (error: unknown) => {
            rejected = true;
            rejectWithError(rejectResults, error);
          },
        );
      }
    }

    pump();
  });
}
