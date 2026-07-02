import type { ESLintFileResult } from "./eslint-runner.js";
import { runEslintForFiles, sweepStaleCacheSiblings } from "./eslint-runner.js";
import type { LintRatchetRuleSourceHashesById } from "./lint-ratchet-baseline.js";
import { type LintRatchetConfig, lintRatchets } from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
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
  started: ReadonlySet<number>,
  typeAwareInFlight: number,
): number | undefined {
  for (let ratchetIndex = 0; ratchetIndex < lintRatchets.length; ratchetIndex += 1) {
    if (started.has(ratchetIndex)) continue;
    const ratchet = lintRatchets[ratchetIndex];
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
): Promise<RatchetEslintCollectionResult> {
  const files = matchingTrackedFiles(ratchet, trackedFiles);
  sweepStaleCacheSiblings(ratchet, ruleSourceHash);
  try {
    return {
      id: ratchet.id,
      ratchet,
      results: await runEslintForFiles(ratchet, ruleSourceHash, files),
    };
  } finally {
    sweepStaleCacheSiblings(ratchet, ruleSourceHash);
  }
}

function rejectWithError(rejectResults: (reason?: unknown) => void, error: unknown): void {
  rejectResults(error instanceof Error ? error : new Error(String(error)));
}

export async function collectRatchets(
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  limit: number,
  trackedFiles: readonly string[],
): Promise<readonly (RatchetEslintCollectionResult | undefined)[]> {
  const results: Array<RatchetEslintCollectionResult | undefined> = [];
  const started = new Set<number>();
  let active = 0;
  let completed = 0;
  let typeAwareInFlight = 0;

  return await new Promise((resolveResults, rejectResults) => {
    let rejected = false;

    function pump(): void {
      if (rejected) return;
      if (completed === lintRatchets.length) {
        resolveResults(results);
        return;
      }
      while (active < limit) {
        const ratchetIndex = nextRunnableRatchetIndex(started, typeAwareInFlight);
        if (ratchetIndex === undefined) return;
        const ratchet = lintRatchets[ratchetIndex];
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
        void collectRatchet(ratchet, ruleSourceHash, trackedFiles).then(
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
