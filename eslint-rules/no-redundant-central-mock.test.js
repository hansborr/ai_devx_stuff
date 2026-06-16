// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import rule, {
  CANONICAL_FACTORY_SOURCES,
  normalizeFactorySource,
} from "./no-redundant-central-mock.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

const TOAST_FACTORY = CANONICAL_FACTORY_SOURCES["react-hot-toast"];
const ROUTER_FACTORY = CANONICAL_FACTORY_SOURCES["@tanstack/react-router"];
const SETUP_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages/client/src/test/setup.ts",
);

describe("no-redundant-central-mock", () => {
  it("flags only byte-identical duplicates of the central setup.ts factories", () => {
    ruleTester.run("no-redundant-central-mock", rule, {
      valid: [
        // Bespoke factory for a central module: a legitimate per-test override.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("@/lib/trpc.js", async () => {
            const { buildMockTRPC } = await import("@/test/mock-trpc.js");
            return { useTRPC: () => buildMockTRPC({ monster: { listData: [] } }) };
          });`,
        },
        // Central module mocked with NO factory (vitest auto-mock) — nothing to compare.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("@/hooks/use-auth.js");`,
        },
        // Not a central module.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("./local-thing.js", async () => await import("./local-thing.js"));`,
        },
        // vi.unmock is not vi.mock.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.unmock("@/hooks/use-auth.js");`,
        },
        // A look-alike call on something other than `vi`.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `helpers.mock("react-hot-toast", async () => await import("@/test/mock-react-hot-toast.js"));`,
        },
        // A bespoke factory whose STRING literal contains comment-like sequences
        // (`//`, `https://`) must not be mistaken for the central factory: comments
        // are stripped via parser tokens, not a regex that is blind to string
        // contents and would otherwise corrupt the comparison.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("react-hot-toast", async () => {
            const note = "see https://example.com/x // still inside the string";
            return { default: note };
          });`,
        },
      ],
      invalid: [
        // Byte-identical single-line duplicate -> removed (with its trailing newline).
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("react-hot-toast", ${TOAST_FACTORY});\nit("x", () => {});`,
          output: `it("x", () => {});`,
          errors: [{ messageId: "redundant" }],
        },
        // Whitespace/comment differences are normalised away before comparison.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("@/lib/trpc.js", async () => {
            // a stale hand-pasted copy of the central factory
            const { buildLazyMockTRPCModule } = await import("@/test/mock-trpc.js");
            const { sharedMockTRPCHolder }   =   await import("@/test/mock-trpc-control.js");
            return buildLazyMockTRPCModule(sharedMockTRPCHolder);
          });`,
          output: ``,
          errors: [{ messageId: "redundant" }],
        },
        // Equivalent extensionless alias specifier resolves to the same central mock.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("@/lib/trpc", async () => {
            const { buildLazyMockTRPCModule } = await import("@/test/mock-trpc.js");
            const { sharedMockTRPCHolder } = await import("@/test/mock-trpc-control.js");
            return buildLazyMockTRPCModule(sharedMockTRPCHolder);
          });`,
          output: ``,
          errors: [{ messageId: "redundant" }],
        },
        // Equivalent relative specifier inside the client source tree resolves too.
        {
          filename: "packages/client/src/hooks/auth-context.test.tsx",
          code: `vi.mock("../lib/trpc", async () => {
            const { buildLazyMockTRPCModule } = await import("@/test/mock-trpc.js");
            const { sharedMockTRPCHolder } = await import("@/test/mock-trpc-control.js");
            return buildLazyMockTRPCModule(sharedMockTRPCHolder);
          });`,
          output: ``,
          errors: [{ messageId: "redundant" }],
        },
        // CRLF line endings: the whole line terminator is consumed, not just \n.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("react-hot-toast", ${TOAST_FACTORY});\r\nit("x", () => {});`,
          output: `it("x", () => {});`,
          errors: [{ messageId: "redundant" }],
        },
        // Indented duplicate: the statement's own indentation is swallowed too,
        // so no dangling whitespace is left on the line.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `describe("d", () => {\n  vi.mock("react-hot-toast", ${TOAST_FACTORY});\n  it("y", () => {});\n});`,
          output: `describe("d", () => {\n  it("y", () => {});\n});`,
          errors: [{ messageId: "redundant" }],
        },
        // Optional call (vi?.mock): the ChainExpression wrapper is removed too,
        // so the fix does not leave an orphan `;`.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi?.mock("react-hot-toast", ${TOAST_FACTORY});\nit("x", () => {});`,
          output: `it("x", () => {});`,
          errors: [{ messageId: "redundant" }],
        },
        // Non-null asserted `vi` is still the Vitest module registry object.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi!.mock("react-hot-toast", ${TOAST_FACTORY});\nit("x", () => {});`,
          output: `it("x", () => {});`,
          errors: [{ messageId: "redundant" }],
        },
        // Factory carrying a TS type argument (the react-router shape) is
        // normalised and compared like any other.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("@tanstack/react-router", ${ROUTER_FACTORY});\nit("x", () => {});`,
          output: `it("x", () => {});`,
          errors: [{ messageId: "redundant" }],
        },
        // Trailing same-line whitespace before the line ending is swallowed too,
        // so the fix never leaves a whitespace-only blank line behind.
        {
          filename: "packages/client/src/foo.test.ts",
          code: `vi.mock("react-hot-toast", ${TOAST_FACTORY});   \nit("x", () => {});`,
          output: `it("x", () => {});`,
          errors: [{ messageId: "redundant" }],
        },
        // Not a standalone statement: the redundancy is still reported, but a
        // fix that deleted only the call range would leave invalid syntax
        // (`const m = ;`), so no autofix is offered (output: null).
        {
          filename: "packages/client/src/foo.test.ts",
          code: `const m = vi.mock("react-hot-toast", ${TOAST_FACTORY});`,
          output: null,
          errors: [{ messageId: "redundant" }],
        },
      ],
    });
  });

  it("keeps the canonical factories in lockstep with setup.ts (drift guard)", () => {
    const source = readFileSync(SETUP_PATH, "utf8");
    const { ast } = tseslint.parser.parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: "module",
      range: true,
    });

    /** @type {Record<string, string>} */
    const factoriesInSetup = {};
    for (const statement of ast.body) {
      if (statement.type !== "ExpressionStatement") continue;
      const call = statement.expression;
      if (call.type !== "CallExpression") continue;
      const callee = call.callee;
      if (
        callee.type !== "MemberExpression" ||
        callee.object.type !== "Identifier" ||
        callee.object.name !== "vi" ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "mock"
      ) {
        continue;
      }
      const [moduleArg, factoryArg] = call.arguments;
      if (
        moduleArg?.type !== "Literal" ||
        typeof moduleArg.value !== "string" ||
        factoryArg?.range === undefined
      ) {
        continue;
      }
      factoriesInSetup[moduleArg.value] = normalizeFactorySource(
        source.slice(factoryArg.range[0], factoryArg.range[1]),
      );
    }

    for (const [moduleName, canonicalSource] of Object.entries(CANONICAL_FACTORY_SOURCES)) {
      expect(
        factoriesInSetup[moduleName],
        `setup.ts no longer vi.mocks ${moduleName}`,
      ).toBeDefined();
      expect(factoriesInSetup[moduleName], `canonical factory for ${moduleName} drifted`).toBe(
        normalizeFactorySource(canonicalSource),
      );
    }

    // Reverse direction: every module setup.ts centrally mocks must be known to
    // the rule. Without this, a newly-centralised mock would be silently
    // un-covered (per-file byte-identical copies of it never flagged) with no
    // failing signal.
    for (const moduleName of Object.keys(factoriesInSetup)) {
      expect(
        CANONICAL_FACTORY_SOURCES[moduleName],
        `setup.ts centrally mocks ${moduleName} but the rule's CANONICAL_FACTORY_SOURCES omits it — add it so per-file duplicates are flagged`,
      ).toBeDefined();
    }
  });
});
