import { describe, expect, it } from "vitest";

import { validateLintRatchetRegistry } from "../kernel/baseline.js";
import type { LintRatchetEngineBinding } from "../kernel/engine-context.js";
import {
  buildProposeRatchet,
  formatLintRatchetPropose,
  type LintRatchetProposeEngine,
  type ProposeSummary,
  runLintRatchetPropose,
} from "./propose.js";

// A synthetic fixture binding: every propose path exercised here rejects
// before collection, so no ESLint run ever reaches the fixture repo root.
const FIXTURE_REPO_ROOT = "/lint-ratchet-fixture";
const FIXTURE_REGISTRY_HINT = "fixture/lint-ratchet-config.ts";
const fixtureBinding: LintRatchetEngineBinding = {
  repoRoot: FIXTURE_REPO_ROOT,
  thirdPartyPluginAllowlist: [],
};

const proposeEngine: LintRatchetProposeEngine = {
  repoRoot: FIXTURE_REPO_ROOT,
  binding: fixtureBinding,
  registryHint: FIXTURE_REGISTRY_HINT,
};

const summary: ProposeSummary = {
  ruleId: "no-console",
  sourceKind: "core",
  files: ["src/**/*.ts"],
  ignores: ["**/dist/**"],
  metric: "message-count",
  ruleOptions: [],
  filesWithFindings: 2,
  totalFindings: 3,
  topFiles: [{ path: "src/a.ts", count: 2 }],
  baselineText: "{}\n",
  registryHint: FIXTURE_REGISTRY_HINT,
};

describe("--propose pairing validation", () => {
  it("normalizes files and ignores into a registry-valid promotable config", () => {
    const ratchet = buildProposeRatchet({
      ruleId: "no-console",
      files: ["src/z/**/*.ts", "src/a/**/*.ts", "src/z/**/*.ts"],
      ignores: ["**/coverage/**", "**/dist/**", "**/coverage/**"],
    });

    expect(ratchet.files).toEqual(["src/a/**/*.ts", "src/z/**/*.ts"]);
    expect(ratchet.ignores).toEqual([
      "**/coverage/**",
      "**/dist/**",
      "**/generated/**",
      "**/node_modules/**",
    ]);
    expect(validateLintRatchetRegistry([ratchet])).toEqual([]);
  });

  it("rejects non-normalized or empty globs before collection", () => {
    expect(() => buildProposeRatchet({ ruleId: "no-console", files: ["./src/**/*.ts"] })).toThrow(
      /file glob must be normalized/u,
    );
    expect(() =>
      buildProposeRatchet({ ruleId: "no-console", files: ["src/**/*.ts"], ignores: [""] }),
    ).toThrow(/ignore glob must be normalized/u);
  });

  it("rejects a metric/ruleId pairing the registry would reject, at preview time", async () => {
    // effective-line-count is only valid with local/max-lines; no ESLint runs
    // because buildProposeRatchet throws before collection.
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "no-console",
          files: ["src/**/*.ts"],
          metric: "effective-line-count",
          trackedFiles: [],
        },
        proposeEngine,
      ),
    ).rejects.toThrow(/effective-line-count metric requires ruleId local\/max-lines/u);
  });

  it("rejects complexity-severity on a non-core rule", async () => {
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "local/whatever",
          files: ["src/**/*.ts"],
          metric: "complexity-severity",
          trackedFiles: [],
        },
        proposeEngine,
      ),
    ).rejects.toThrow(/complexity-severity metric requires core ruleId complexity/u);
  });
});

describe("formatLintRatchetPropose promotable config", () => {
  it("prints every registry-required field so the copy-paste block is complete", () => {
    const output = formatLintRatchetPropose(summary);
    for (const field of [
      "parserProfile:",
      "mode:",
      "metric:",
      "repairKind:",
      "principle:",
      'source: { kind: "core" }',
    ]) {
      expect(output).toContain(field);
    }
    // The retired `target` field must not be taught to adopters.
    expect(output).not.toContain("target:");
  });

  it("omits the source line for a local rule (source defaults to local)", () => {
    const output = formatLintRatchetPropose({ ...summary, sourceKind: "local", ruleId: "local/x" });
    expect(output).not.toContain('source: { kind: "core" }');
    expect(output).toContain("parserProfile:");
  });
});
