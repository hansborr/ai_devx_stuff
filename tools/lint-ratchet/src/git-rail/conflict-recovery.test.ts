import { describe, expect, it } from "vitest";

import type { LintRatchetWorkflowVocabulary } from "../kernel/engine-context.js";
import { renderLintRatchetConflictRecovery } from "./conflict-recovery.js";

describe("renderLintRatchetConflictRecovery", () => {
  it("renders the adopter's update commands instead of Musi command names", () => {
    const workflowVocabulary: LintRatchetWorkflowVocabulary = {
      updateCommand: "pnpm ratchet:update",
      regressionUpdateCommand: 'pnpm ratchet:accept --reason "<why>"',
      debtAcceptanceCommand: 'pnpm ratchet:accept --reason "<why>"',
      installMergeDriverCommand: "pnpm ratchet:install-driver",
      restoreBaselineOursCommand: (baseline) => `pnpm ratchet:restore-ours ${baseline}`,
      trendAllCommand: "pnpm ratchet:trend --all",
    };

    const rendered = renderLintRatchetConflictRecovery("quality-floor.json", workflowVocabulary);

    expect(rendered).toContain("pnpm ratchet:update");
    expect(rendered).toContain('pnpm ratchet:accept --reason "<why>"');
    expect(rendered).not.toContain("bun run lint:ratchet:update");
  });
});
