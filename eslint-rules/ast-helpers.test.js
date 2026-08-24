// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import * as astHelpers from "./ast-helpers.js";
import { ruleFromModule } from "./rule-module-shape.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();
const here = dirname(fileURLToPath(import.meta.url));

const {
  importSpecifierName,
  isFunctionNode,
  parentOf,
  staticKeyName,
  staticPropertyName,
  unwrapChain,
} = astHelpers;

function javascriptModuleNames() {
  return readdirSync(here)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => !name.endsWith(".test.js"));
}

/** @returns {Promise<Array<{ moduleName: string, mod: object, rule: unknown | undefined }>>} */
async function javascriptModules() {
  const modules = [];
  for (const moduleName of javascriptModuleNames()) {
    const mod = await import(pathToFileURL(join(here, moduleName)).href);
    modules.push({ moduleName, mod, rule: ruleFromModule(mod) });
  }
  return modules;
}

/**
 * @param {Array<{ moduleName: string, mod: object, rule: unknown | undefined }>} modules
 * @param {string} targetModuleName
 * @returns {Map<string, string>}
 */
function protectedOwnersForTarget(modules, targetModuleName) {
  const owners = new Map();
  for (const { moduleName, mod } of modules) {
    if (moduleName === targetModuleName) continue;
    for (const name of Object.keys(mod)) {
      if (name !== "default") owners.set(name, moduleName);
    }
  }
  return owners;
}

/**
 * @param {string} source
 * @param {Map<string, string>} protectedOwners
 * @param {string} moduleName
 */
function declarationCollisions(source, protectedOwners, moduleName) {
  const { ast, visitorKeys } = tseslint.parser.parseForESLint(source, {
    ecmaVersion: 2022,
    sourceType: "module",
  });
  const collisions = [];

  /** @param {string} name */
  function recordCollision(name) {
    const exportingOwner = protectedOwners.get(name);
    if (exportingOwner !== undefined) {
      collisions.push(
        `${moduleName} declares ${name}, which ${exportingOwner} exports; import the shared helper instead`,
      );
    }
  }

  /** @param {import('@typescript-eslint/types').TSESTree.Node} node */
  function visit(node) {
    if (node.type === "FunctionDeclaration" && node.id !== null) {
      recordCollision(node.id.name);
    }
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
      recordCollision(node.id.name);
    }

    const keyedNode = /** @type {unknown} */ (node);
    if (typeof keyedNode !== "object" || keyedNode === null) return;
    for (const key of visitorKeys[node.type] ?? []) {
      const value = Reflect.get(keyedNode, key);
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (
          typeof child === "object" &&
          child !== null &&
          "type" in child &&
          typeof child.type === "string"
        ) {
          visit(/** @type {import('@typescript-eslint/types').TSESTree.Node} */ (child));
        }
      }
    }
  }

  visit(ast);
  return collisions;
}

/** @type {import('eslint').Rule.RuleModule} */
const probeRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Probe shared AST helpers in tests",
      principle: "Test-only probe rule.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      computed: "computed property resolved",
      imported: "import specifier resolved",
      key: "static object key resolved",
      plain: "plain property resolved",
      programParent: "program parent normalized",
      supportedFunction: "supported function node",
      unwrapped: "chain expression unwrapped",
    },
    schema: [],
  },

  create(context) {
    return {
      Program(node) {
        if (context.sourceCode.text === "probeRoot;" && parentOf(node) === undefined) {
          context.report({ node, messageId: "programParent" });
        }
      },

      ImportSpecifier(node) {
        if (importSpecifierName(node) === "source-name") {
          context.report({ node, messageId: "imported" });
        }
      },

      MemberExpression(node) {
        const name = staticPropertyName(node);
        if (name === "plain") context.report({ node, messageId: "plain" });
        if (name === "computed") context.report({ node, messageId: "computed" });
      },

      ChainExpression(node) {
        if (unwrapChain(node) === node.expression) {
          context.report({ node, messageId: "unwrapped" });
        }
      },

      Property(node) {
        if (staticKeyName(node) === "target") context.report({ node, messageId: "key" });
      },

      "ArrowFunctionExpression, FunctionDeclaration, FunctionExpression"(node) {
        if (isFunctionNode(node)) {
          context.report({ node, messageId: "supportedFunction" });
        }
      },
    };
  },
};

describe("ast-helpers", () => {
  it("resolves static member names, import names, and chain expressions", () => {
    ruleTester.run("ast-helpers-probe", probeRule, {
      valid: [
        "object[dynamic]",
        "object[1]",
        "const value = object.other",
        // A computed key is never a static name, even when it reads like one.
        "const held = { [target]: 1 };",
        "const held = { other: 1 };",
      ],
      invalid: [
        {
          code: "const held = { target: 1 };",
          errors: [{ messageId: "key" }],
        },
        {
          // A NON-computed object key may legitimately be a string literal, so
          // staticKeyName cannot simply mirror staticPropertyName's computed logic.
          code: 'const held = { "target": 1 };',
          errors: [{ messageId: "key" }],
        },
        {
          code: "object.plain()",
          errors: [{ messageId: "plain" }],
        },
        {
          code: 'object["computed"]()',
          errors: [{ messageId: "computed" }],
        },
        {
          code: 'import { "source-name" as localName } from "library";',
          errors: [{ messageId: "imported" }],
        },
        {
          code: "object?.method()",
          errors: [{ messageId: "unwrapped" }],
        },
      ],
    });
  });

  it("normalizes Program.parent and recognizes every function node shape", () => {
    ruleTester.run("ast-helpers-functions-probe", probeRule, {
      valid: [],
      invalid: [
        {
          code: "probeRoot;",
          errors: [{ messageId: "programParent" }],
        },
        {
          code: "probe(() => {})",
          errors: [{ messageId: "supportedFunction" }],
        },
        {
          code: "probe(function () {})",
          errors: [{ messageId: "supportedFunction" }],
        },
        {
          code: "function declared() {}",
          errors: [{ messageId: "supportedFunction" }],
        },
      ],
    });

    expect(isFunctionNode(undefined)).toBe(false);
    expect(isFunctionNode(null)).toBe(false);
  });

  it("keeps every other module's named exports out of rule-local declarations", async () => {
    const modules = await javascriptModules();
    const collisions = [];
    for (const { moduleName, rule } of modules) {
      if (rule === undefined) continue;
      const source = readFileSync(join(here, moduleName), "utf8");
      const protectedOwners = protectedOwnersForTarget(modules, moduleName);
      collisions.push(...declarationCollisions(source, protectedOwners, moduleName));
    }

    expect(collisions).toEqual([]);
  });

  it("reports nested copies from other modules and ignores the target's exports", () => {
    const modules = [
      {
        moduleName: "source-rule.js",
        mod: { default: {}, isEmitMember() {} },
        rule: {},
      },
      {
        moduleName: "target-rule.js",
        mod: { default: {}, targetHelper() {} },
        rule: {},
      },
    ];
    const protectedOwners = protectedOwnersForTarget(modules, "target-rule.js");
    const collisions = declarationCollisions(
      [
        "const rule = { create() {",
        "  const isEmitMember = () => {};",
        "  const targetHelper = () => {};",
        "} };",
      ].join("\n"),
      protectedOwners,
      "target-rule.js",
    );

    expect(collisions).toEqual([
      "target-rule.js declares isEmitMember, which source-rule.js exports; import the shared helper instead",
    ]);
  });
});
