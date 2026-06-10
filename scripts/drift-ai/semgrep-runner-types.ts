// Runner-facing types for the Semgrep subprocess harness (semgrep plan,
// slice 2), split from semgrep-runner.ts the way dolos-runner-types.ts is
// split from dolos-runner.ts.

import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";

import type { DriftAiIgnoreConfig } from "./config.js";
import type { SemgrepScanOutput } from "./semgrep-types.js";

// Narrowed subprocess seam: tests only need the fields the runner reads, while
// node's real spawnSync remains directly assignable.
export type SemgrepSpawnResult = Pick<
  SpawnSyncReturns<string>,
  "error" | "status" | "stdout" | "stderr" | "signal"
>;

export type SemgrepSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SemgrepSpawnResult;

// How the engine was located: `--semgrep-bin` override, the tools-checkout
// install, or `semgrep` on PATH (plan decision 2's resolution order).
export type SemgrepCommandSource = "override" | "tools-checkout" | "path";

export type SemgrepToolInfo = {
  readonly command: string;
  readonly source: SemgrepCommandSource;
  readonly version?: string;
};

export type SemgrepRunnerInput = {
  readonly repoRoot: string;
  // Scan targets handed to Semgrep verbatim (it does its own file discovery;
  // plan decision 7). Empty roots normalize to ".".
  readonly roots: readonly string[];
  // Drift ignore config, mapped to repeated --exclude flags (never a
  // .semgrepignore write).
  readonly ignore: DriftAiIgnoreConfig;
  // Allowed rule sources in declaration order — local config paths and/or
  // registry pack names — passed verbatim as repeated --config values. The
  // license/registry gate runs upstream (semgrep-rule-sources.ts).
  readonly ruleConfigs: readonly string[];
};

export type SemgrepRunnerCaps = {
  readonly timeoutMs: number;
};

export type SemgrepRunnerResult =
  | {
      readonly ok: true;
      readonly tool: SemgrepToolInfo;
      readonly scan: SemgrepScanOutput;
      readonly caps: SemgrepRunnerCaps;
    }
  | {
      readonly ok: false;
      readonly reason: "run-failed" | "timeout" | "tool-unavailable";
      readonly error: string;
      readonly tool: SemgrepToolInfo;
      readonly caps: SemgrepRunnerCaps;
      // Which Semgrep subprocess produced the failed result. Setup failures
      // before any subprocess may omit this.
      readonly phase?: "probe" | "scan";
    };

export type SemgrepRunner = (input: SemgrepRunnerInput) => SemgrepRunnerResult;

export type DefaultSemgrepRunnerOptions = {
  // `--semgrep-bin` explicit override; skips the tools-checkout/PATH probes.
  readonly bin?: string;
  readonly timeoutMs?: number;
  readonly spawn?: SemgrepSpawn;
  // Seams for the tools-checkout probe so tests never touch the real
  // filesystem install.
  readonly fileExists?: (candidate: string) => boolean;
  readonly moduleDir?: string;
};
