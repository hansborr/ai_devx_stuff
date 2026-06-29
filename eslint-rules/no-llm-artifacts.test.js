// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-llm-artifacts.js";

const ruleTester = makeRuleTester();

describe("no-llm-artifacts", () => {
  it("reports leftover editing notes, bare TODO comments, and incomplete throws", () => {
    ruleTester.run("no-llm-artifacts", rule, {
      valid: [
        { code: "// Explain why this mapping uses SRD order.\nconst value = 1;" },
        { code: "// TODO(#123): split this after the endpoint lands\nconst value = 1;" },
        { code: "// TODO: see docs/roadmap/developer-experience.md DX4.1\nconst value = 1;" },
        { code: "// TODO: tracked in docs/agent_notes/in_progress/example.md\nconst value = 1;" },
        { code: "// TODO: PR #456 removes this compatibility shim\nconst value = 1;" },
        { code: "const inputPlaceholder = '... existing code ...';" },
        { code: "throw new Error('Unsupported caster type');" },
        { code: "throw new Error('Not implemented by this adapter');" },
      ],
      invalid: [
        {
          code: "// ... existing code ...\nconst value = 1;",
          errors: [{ messageId: "leftoverEditNote" }],
        },
        {
          code: "/* rest of the function remains the same */\nconst value = 1;",
          errors: [{ messageId: "leftoverEditNote" }],
        },
        {
          code: "// abbreviated for brevity\nconst value = 1;",
          errors: [{ messageId: "leftoverEditNote" }],
        },
        {
          code: "// implementation goes here\nconst value = 1;",
          errors: [{ messageId: "leftoverEditNote" }],
        },
        {
          code: "// TODO: implement saving throws\nconst value = 1;",
          errors: [{ messageId: "todoNeedsReference" }],
        },
        {
          code: "function parse() { throw new Error('Not implemented'); }",
          errors: [{ messageId: "incompleteImplementation" }],
        },
        {
          code: "function parse() { throw new Error(`TODO`); }",
          errors: [{ messageId: "incompleteImplementation" }],
        },
      ],
    });
  });
});
