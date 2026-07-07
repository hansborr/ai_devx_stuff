// @ts-check

/**
 * Unit/integration test files must be named with a feature prefix and contain
 * at least one test block.
 *
 * Adapted from @factory/eslint-plugin's test-file-location rule. The original
 * also flagged any `test/` or `__tests__/` segment in the path; that heuristic
 * is dropped here because Musi has legitimate cross-cutting tests under
 * `packages/server/src/test/` that sit next to their helpers. Playwright e2e
 * specs stay on Playwright-specific lint rules.
 */

// Setup/teardown hooks (beforeEach/afterEach/beforeAll/afterAll) deliberately
// don't count: a file containing only those is a stub, not a test file.
const TEST_BLOCK_NAMES = new Set(["describe", "it", "test"]);
const UNIT_TEST_FILE_PATTERN = /\.(?:test\.(?:ts|tsx)|spec\.ts)$/;
const UNIT_TEST_BASENAME_PATTERN = /^.+\.(?:test\.(?:ts|tsx)|spec\.ts)$/;
const E2E_SEGMENT_PATTERN = /(?:^|[/\\])e2e(?:[/\\]|$)/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce test file naming and require at least one test block",
      principle:
        "Test files must follow naming conventions and contain test blocks so they colocate with the code they cover.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      wrongNaming:
        "Test file basename is missing a name prefix. Rename to `<feature>.test.ts`, `.test.tsx`, or `.spec.ts` so the file colocates with the code it covers.",
      missingTests:
        "Add a `describe`, `it`, or `test` block. If this file is a test helper, rename it to drop the .test/.spec suffix so it stops matching the test-file convention.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    const isTestFile = UNIT_TEST_FILE_PATTERN.test(filename) && !E2E_SEGMENT_PATTERN.test(filename);

    if (!isTestFile) {
      return {};
    }

    let hasTestBlocks = false;

    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && TEST_BLOCK_NAMES.has(node.callee.name)) {
          hasTestBlocks = true;
          return;
        }
        // describe.each(...), it.skip(...), test.concurrent(...), etc.
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          TEST_BLOCK_NAMES.has(node.callee.object.name)
        ) {
          hasTestBlocks = true;
        }
      },

      "Program:exit"(node) {
        if (!UNIT_TEST_BASENAME_PATTERN.test(filename.split(/[/\\]/).pop() ?? "")) {
          context.report({ node, messageId: "wrongNaming" });
        }
        if (!hasTestBlocks) {
          context.report({ node, messageId: "missingTests" });
        }
      },
    };
  },
};
