import {
  createLintRatchetEngineContext,
  DEFAULT_BASELINE_FILENAME,
  DEFAULT_DEBT_LOG_FILENAME,
} from "@musi/lint-ratchet/kernel/engine-context.js";
import { describe, expect, it } from "vitest";

import { fixtureWorkflowVocabulary } from "./fixture-workflow-vocabulary.js";

describe("createLintRatchetEngineContext", () => {
  it("derives absolute baseline and debt-log paths from repoRoot using defaults", () => {
    const context = createLintRatchetEngineContext({
      repoRoot: "/repo",
      workflowVocabulary: fixtureWorkflowVocabulary,
    });
    expect(context.repoRoot).toBe("/repo");
    expect(context.baselinePath).toBe(`/repo/${DEFAULT_BASELINE_FILENAME}`);
    expect(context.debtLogPath).toBe(`/repo/${DEFAULT_DEBT_LOG_FILENAME}`);
    expect(context.workflowVocabulary).toBe(fixtureWorkflowVocabulary);
  });

  it("honors overridden baseline and debt-log filenames", () => {
    const context = createLintRatchetEngineContext({
      repoRoot: "/repo",
      baselineFilename: "custom.baseline.json",
      debtLogFilename: "custom.debt.jsonl",
      workflowVocabulary: fixtureWorkflowVocabulary,
    });
    expect(context.baselinePath).toBe("/repo/custom.baseline.json");
    expect(context.debtLogPath).toBe("/repo/custom.debt.jsonl");
  });
});
