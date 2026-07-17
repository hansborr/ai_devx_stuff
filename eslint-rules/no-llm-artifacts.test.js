// @ts-check
import { describe, expect, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule, { TODO_REFERENCE_PATTERN } from "./no-llm-artifacts.js";

const ruleTester = makeRuleTester();

describe("no-llm-artifacts", () => {
  it("keeps TODO reference guidance aligned with the accepted reference forms", () => {
    const message = rule.meta.messages.todoNeedsReference;
    const acceptedForms = [
      ["issue/PR id", "TODO(issue #123): split this after the endpoint lands"],
      ["issue/PR id", "TODO: PR #456 removes this compatibility shim"],
      ["issue/PR id", "TODO: ABC-7 removes this compatibility shim"],
      ["URL", "TODO: https://example.test/tasks/123"],
      ["docs/roadmap|agent_notes path", "TODO: docs/roadmap/developer-experience.md"],
      ["docs/roadmap|agent_notes path", "TODO: docs/agent_notes/in_progress/example.md"],
    ];

    for (const [messageToken, acceptedExample] of acceptedForms) {
      expect(message).toContain(messageToken);
      expect(TODO_REFERENCE_PATTERN.test(acceptedExample), messageToken).toBe(true);
    }
    expect(TODO_REFERENCE_PATTERN.test("TODO: check the roadmap before deleting this")).toBe(false);
    expect(TODO_REFERENCE_PATTERN.test("TODO: see the agent note for context")).toBe(false);
    expect(TODO_REFERENCE_PATTERN.test("TODO: phase-2 of the cleanup")).toBe(false);
    expect(TODO_REFERENCE_PATTERN.test("TODO: http://")).toBe(false);
    expect(TODO_REFERENCE_PATTERN.test("TODO: docs/roadmap/...")).toBe(false);
    expect(TODO_REFERENCE_PATTERN.test("TODO: notdocs/roadmap/file.md")).toBe(false);
  });

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
          code: "// TODO: check the roadmap before deleting this\nconst value = 1;",
          errors: [{ messageId: "todoNeedsReference" }],
        },
        {
          code: "// TODO: see the agent note for context\nconst value = 1;",
          errors: [{ messageId: "todoNeedsReference" }],
        },
        {
          code: "// TODO: phase-2 of the cleanup\nconst value = 1;",
          errors: [{ messageId: "todoNeedsReference" }],
        },
        {
          code: "// TODO: http://\nconst value = 1;",
          errors: [{ messageId: "todoNeedsReference" }],
        },
        {
          code: "// TODO: docs/roadmap/...\nconst value = 1;",
          errors: [{ messageId: "todoNeedsReference" }],
        },
        {
          code: "// TODO: notdocs/roadmap/file.md\nconst value = 1;",
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
