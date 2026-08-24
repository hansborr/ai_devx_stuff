import { describe, expect, it } from "vitest";

import { customWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import { regressionRecoveryFooter } from "./recovery-command.js";

describe("workflow recovery commands", () => {
  it("derives the recovery footer from the adapter vocabulary", () => {
    expect(regressionRecoveryFooter(customWorkflowVocabulary)).toBe(
      'Recovery: fix the regressions above; if the new findings are intentional, run `fixture-ratchet update --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"`.',
    );
  });
});
