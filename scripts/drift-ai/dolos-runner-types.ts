import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";

import type {
  DolosCandidatePair,
  DolosParseTruncation,
  DolosReportFiles,
  DolosReportMetadata,
} from "./dolos-types.js";
import type { NearDuplicateSourceInventoryInput } from "./near-duplicates-runner.js";

export type DolosSpawnResult = Pick<
  SpawnSyncReturns<string>,
  "error" | "status" | "stdout" | "stderr" | "signal"
>;

export type DolosSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => DolosSpawnResult;

export type DolosCommandSource = "path" | "override";

export type DolosToolInfo = {
  readonly command: string;
  readonly source: DolosCommandSource;
  readonly version?: string;
};

export type DolosRunnerInput = NearDuplicateSourceInventoryInput & {
  readonly languageMode: string;
  readonly threshold: number;
  readonly maxFiles: number;
  readonly maxCandidatePairs: number;
  readonly maxReportedPairs: number;
};

export type DolosRunnerCaps = {
  readonly timeoutMs: number;
  readonly maxFiles: number;
  readonly maxCandidatePairs: number;
  readonly maxReportedPairs: number;
};

export type DolosRunnerTruncation = DolosParseTruncation & {
  readonly eligibleFiles: number;
  readonly consideredFiles: number;
  readonly filesTruncated: boolean;
};

export type DolosRunnerResult =
  | {
      readonly ok: true;
      readonly tool: DolosToolInfo;
      readonly metadata: DolosReportMetadata;
      readonly candidates: readonly DolosCandidatePair[];
      readonly caps: DolosRunnerCaps;
      readonly truncation: DolosRunnerTruncation;
    }
  | {
      readonly ok: false;
      readonly reason: "run-failed" | "timeout" | "tool-unavailable";
      readonly error: string;
      readonly tool: DolosToolInfo;
      readonly caps: DolosRunnerCaps;
      readonly truncation: Pick<
        DolosRunnerTruncation,
        "consideredFiles" | "eligibleFiles" | "filesTruncated"
      >;
    };

export type DolosRunner = (input: DolosRunnerInput) => DolosRunnerResult;

export type DefaultDolosRunnerOptions = {
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly spawn?: DolosSpawn;
  readonly readReportFiles?: (outputDir: string) => DolosReportFiles;
};
