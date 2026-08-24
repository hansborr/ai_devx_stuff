import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";

const FRESHNESS_COMMAND = '. "$1" || exit 1\nmusi_dependency_freshness "$2"';

interface FreshnessProbeResult {
  readonly error?: Error;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ToolchainFreshnessDeps {
  readonly probe: (helperPath: string, repoRoot: string) => FreshnessProbeResult;
}

const defaultDeps: ToolchainFreshnessDeps = {
  probe: (helperPath, repoRoot) => {
    const result = spawnSync(
      "sh",
      ["-c", FRESHNESS_COMMAND, "lint-ratchet-freshness", helperPath, repoRoot],
      { encoding: "utf8" },
    );
    return {
      ...(result.error === undefined ? {} : { error: result.error }),
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};

function parseFreshnessResult(output: string): {
  readonly status: string;
  readonly message: string;
} {
  const line = output.trimEnd();
  const separator = line.indexOf("\t");
  if (separator < 0) {
    throw new ConfigError("dependency freshness helper returned an invalid result");
  }
  return { status: line.slice(0, separator), message: line.slice(separator + 1) };
}

/**
 * Fail closed before a Musi baseline update can serialize package identities
 * from a stale install. The POSIX helper remains the sole implementation of
 * digest and legacy-mtime semantics; this adapter only invokes and interprets
 * its status protocol.
 */
export function assertToolchainFreshForBaselineUpdate(
  repoRoot: string,
  updateCommand: string,
  deps: ToolchainFreshnessDeps = defaultDeps,
): void {
  const helperPath = resolve(repoRoot, "scripts/dependency-freshness.sh");
  const result = deps.probe(helperPath, repoRoot);
  if (result.error !== undefined) {
    throw new ConfigError(`dependency freshness helper could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new ConfigError(
      `dependency freshness helper failed${detail.length === 0 ? "" : `: ${detail}`}`,
    );
  }

  const freshness = parseFreshnessResult(result.stdout);
  if (freshness.status === "fresh") return;
  if (freshness.status === "warn") {
    throw new ConfigError(
      "cannot verify install freshness without bun.lock; restore bun.lock, run bun install, " +
        `then re-run ${updateCommand}`,
    );
  }
  if (freshness.status === "missing" || freshness.status === "stale") {
    throw new ConfigError(
      `install state is stale; run bun install, then re-run ${updateCommand}` +
        (freshness.message.length === 0 ? "" : ` (${freshness.message})`),
    );
  }
  throw new ConfigError(`dependency freshness helper returned unknown status: ${freshness.status}`);
}
