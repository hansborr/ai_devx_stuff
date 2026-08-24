import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { customWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import { createLintRatchetEngineContext } from "../kernel/engine-context.js";
import { resolveRetireRequest } from "./retire-update.js";

describe("resolveRetireRequest", () => {
  it("names the bound update command exactly when the baseline is missing", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-retire-"));
    try {
      const context = createLintRatchetEngineContext({
        repoRoot,
        baselineFilename: "custom-floor.json",
        workflowVocabulary: customWorkflowVocabulary,
      });
      await expect(resolveRetireRequest(context, "ratchet/retired", [])).rejects.toThrow(
        "custom-floor.json does not exist; run fixture-ratchet update",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
