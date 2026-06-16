import { describe, expect, it } from "vitest";

import type { PathProbe } from "./adapter-support.js";
import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { knipDuplicatesCheck } from "./knip-duplicates-check.js";
import { orphanFilesCheck } from "./knip-orphan-files-check.js";
import type { KnipRunner } from "./knip-runner.js";
import { unusedExportsCheck } from "./knip-unused-exports-check.js";
import { buildSourceExtensions } from "./scope.js";

function pathExistsFor(present: readonly string[]): PathProbe {
  const set = new Set(present);
  return (relativePath) => set.has(relativePath);
}

const RUN_STATE = {
  inventoryByDir: null,
  repoRoot: "/repo/target",
  suppressionDiffRef: null,
  config: DEFAULT_DRIFT_AI_CONFIG,
  roots: [],
  sourceExtensions: buildSourceExtensions([]),
  warnStderr: () => undefined,
} as const;

const INSTALLED_WITH_ROOT_CONFIG = ["node_modules", "knip.config.ts"];

const KNIP_CHECKS = [
  { id: "orphan-files", plugin: orphanFilesCheck },
  { id: "unused-exports", plugin: unusedExportsCheck },
  { id: "knip-duplicates", plugin: knipDuplicatesCheck },
] as const;

function makeInput(check: (typeof KNIP_CHECKS)[number]["id"], knip: KnipRunner): CheckRunInput {
  return {
    ...RUN_STATE,
    detectorScope: { scopeMode: "current", files: [] },
    env: {
      repoRoot: "/repo/target",
      overrides: {
        knip,
        readFile: () => undefined,
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
      },
      cli: parseArgs(["--scope", "current", "--check", check]),
      warnStderr: () => undefined,
    },
  };
}

describe("knip pass-through check wiring", () => {
  it.each(KNIP_CHECKS)("maps tool-unavailable to the shared skip for $id", ({ id, plugin }) => {
    const outcome = plugin.runWithSelectedConfig(
      makeInput(id, () => ({ ok: false, reason: "tool-unavailable", error: "searched ..." })),
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.code).toBe("tool-not-installed");
      expect(outcome.reason).toContain("knip executable not found");
    }
  });

  it.each(KNIP_CHECKS)("maps knip timeout to the shared skip for $id", ({ id, plugin }) => {
    const outcome = plugin.runWithSelectedConfig(
      makeInput(id, () => ({
        ok: false,
        reason: "timeout",
        error: "timeout of 600000ms",
      })),
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.code).toBe("tool-timeout");
      expect(outcome.reason).toContain("knip exceeded the configured timeout");
    }
  });

  it.each(KNIP_CHECKS)("keeps spawn failures as a single diagnostic for $id", ({ id, plugin }) => {
    const outcome = plugin.runWithSelectedConfig(
      makeInput(id, () => ({ ok: false, reason: "spawn-failed", error: "EACCES" })),
    );

    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.check).toBe(id);
      expect(outcome.findings[0]?.message).toContain("knip subprocess failed");
      expect(outcome.findings[0]?.provenance).toBeUndefined();
    }
  });

  it.each(KNIP_CHECKS)("keeps unreadable JSON as a single diagnostic for $id", ({ id, plugin }) => {
    const outcome = plugin.runWithSelectedConfig(
      makeInput(id, () => ({
        ok: true,
        reportJson: "<<garbage>>",
        exitCode: 2,
        stderr: "bad output",
      })),
    );

    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.check).toBe(id);
      expect(outcome.findings[0]?.message).toContain("unreadable JSON");
      expect(outcome.findings[0]?.message).toContain("bad output");
      expect(outcome.findings[0]?.provenance).toBeUndefined();
    }
  });
});
