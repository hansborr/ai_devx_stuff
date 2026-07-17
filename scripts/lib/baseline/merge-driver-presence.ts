import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const SUPPRESS_MERGE_DRIVER_WARN_ENV = "MUSI_SUPPRESS_MERGE_DRIVER_WARN";
// The checker only reads git config, so it should return in well under a second.
// Bound it anyway: this runs inline on every non-CI ratchet/knip/max-lines lint, so
// a wedged checker (stuck git, hung filesystem) would otherwise hang lint with it.
const CHECK_TIMEOUT_MS = 5000;

function isTimeout(error: Error | undefined): boolean {
  return error !== undefined && "code" in error && error.code === "ETIMEDOUT";
}

export function forwardMissingMergeDriverWarning(options: {
  readonly checkScriptPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly warn: (message: string) => void;
  readonly timeoutMs?: number;
}): void {
  if (options.env.CI || options.env[SUPPRESS_MERGE_DRIVER_WARN_ENV]) return;

  // The advisory is dead in exactly the config where it matters — an adopter who
  // skipped copying scripts/git/* — if a missing checker script no-ops silently.
  // Name it instead.
  if (!existsSync(options.checkScriptPath)) {
    options.warn(
      `WARN: merge-driver presence check skipped: checker script not found at ${options.checkScriptPath}`,
    );
    return;
  }

  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  let checkerStdout: string;
  try {
    const result = spawnSync("bash", [options.checkScriptPath], {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    if (isTimeout(result.error)) {
      // Legible, non-fatal: name the timeout instead of hanging or dying, and skip
      // the advisory rather than blocking the lint run behind a wedged checker.
      options.warn(
        `WARN: merge-driver presence check timed out after ${String(timeoutMs)}ms; skipping merge-driver advisory`,
      );
      return;
    }
    if (result.error !== undefined) {
      options.warn(
        `WARN: merge-driver presence check skipped: checker failed to spawn (${result.error.message})`,
      );
      return;
    }
    checkerStdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.warn(`WARN: merge-driver presence check skipped: ${message}`);
    return;
  }

  const warning = checkerStdout.split("\n").find((line) => line.startsWith("WARN:"));
  if (warning !== undefined) options.warn(warning);
}
