// @ts-check
import { describe, it } from "vitest";

import rule from "./no-node-builtin-reference.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();

describe("no-node-builtin-reference", () => {
  it("reports good-faith non-ESM Node builtin module references", () => {
    ruleTester.run("no-node-builtin-reference", rule, {
      valid: [
        'await import("@musi/shared");',
        'await import("./combat.js");',
        "await import(moduleSpecifier);",
        "await import(`node:${moduleName}`);",
        'type Contract = import("@musi/shared").Contract;',
        'function require(name) { return name; } require("node:fs");',
        [
          "function inspect(process, Buffer) {",
          "  type Proc = typeof process.cwd;",
          "  type Bytes = typeof Buffer.from;",
          "  return [process, Buffer] as const;",
          "}",
          "void inspect;",
        ].join("\n"),
        "interface Buffer {}\ninterface Bytes extends Buffer {}",
        "namespace NodeJS { export interface ProcessEnv {} }\ntype Env = NodeJS.ProcessEnv;",
      ],
      invalid: [
        {
          code: 'await import("node:fs/promises");',
          errors: [{ messageId: "nodeBuiltinReference" }],
        },
        {
          code: 'await import("fs/promises");',
          errors: [{ messageId: "nodeBuiltinReference" }],
        },
        {
          code: "await import(`node:fs/promises`);",
          errors: [{ messageId: "nodeBuiltinReference" }],
        },
        {
          code: 'type Stats = import("node:fs").Stats;',
          errors: [{ messageId: "nodeBuiltinReference" }],
        },
        {
          code: 'const fs = require("node:fs");',
          errors: [{ messageId: "nodeBuiltinReference" }],
        },
        {
          code: "const fs = require(`node:fs`);",
          errors: [{ messageId: "nodeBuiltinReference" }],
        },
        {
          code: 'import fs = require("node:fs");',
          errors: [{ messageId: "nodeBuiltinReference" }],
        },
        {
          code: "process.cwd();",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: 'Buffer.from("value");',
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "void __dirname;\nvoid __filename;",
          errors: [{ messageId: "nodeGlobalReference" }, { messageId: "nodeGlobalReference" }],
        },
        {
          code: "type Bytes = Buffer;",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "type Proc = typeof process;",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "type Env = typeof process.env;",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "type Cwd = typeof process.cwd;",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "type From = typeof Buffer.from;",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "interface Bytes extends Buffer {}",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "interface Env extends NodeJS.ProcessEnv {}",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
        {
          code: "type Timer = NodeJS.Timeout;",
          errors: [{ messageId: "nodeGlobalReference" }],
        },
      ],
    });
  });
});
