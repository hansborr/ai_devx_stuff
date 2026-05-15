// @ts-check

/**
 * Test files must be named *.test.ts(x) and contain at least one test block.
 *
 * Adapted from @factory/eslint-plugin's test-file-location rule. The original
 * also flagged any `test/` or `__tests__/` segment in the path; that heuristic
 * is dropped here because Musi has legitimate cross-cutting tests under
 * `packages/server/src/test/` that sit next to their helpers.
 */

// Setup/teardown hooks (beforeEach/afterEach/beforeAll/afterAll) deliberately
// don't count: a file containing only those is a stub, not a test file.
const TEST_BLOCK_NAMES = new Set(["describe", "it", "test"]);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce *.test.ts(x) naming and require at least one test block",
    },
    messages: {
      wrongNaming:
        "Test file basename is missing a name prefix. Rename to `<feature>.test.ts` (or `.test.tsx`) so the file colocates with the code it covers.",
      missingTests:
        "This file is named `*.test.ts(x)` but contains no `describe`, `it`, or `test` blocks (suite hooks alone don't count). Either add a test block or rename the file; helpers belong outside the `.test.` naming.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename;
    const isTestFile = /\.test\.(ts|tsx)$/.test(filename);

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
        if (!/^.+\.test\.(ts|tsx)$/.test(filename.split("/").pop() ?? "")) {
          context.report({ node, messageId: "wrongNaming" });
        }
        if (!hasTestBlocks) {
          context.report({ node, messageId: "missingTests" });
        }
      },
    };
  },
};
