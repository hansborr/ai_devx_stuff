import { describe, expect, it } from "vitest";

import { customWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import { parseBaselineWithRuleSourceDrift } from "./rule-source-drift.js";

describe("parseBaselineWithRuleSourceDrift", () => {
  it("uses the adapter's custom baseline filename in conflict-marker remediation", () => {
    const parsed = parseBaselineWithRuleSourceDrift(
      '<<<<<<< ours\n{"version":2}\n=======\n{"version":2}\n>>>>>>> theirs\n',
      [],
      new Map(),
      {
        workflowVocabulary: customWorkflowVocabulary,
        baselineFile: "config/custom-floor.json",
      },
    );

    expect(parsed.failures.join("\n")).toContain(
      "config/custom-floor.json is generated; Git conflict markers mean its semantic merge driver was not installed",
    );
    expect(parsed.failures.join("\n")).toContain(
      "fixture-ratchet restore-ours config/custom-floor.json",
    );
  });
});
