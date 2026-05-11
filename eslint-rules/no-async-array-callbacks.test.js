// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-async-array-callbacks.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("no-async-array-callbacks", () => {
  it("reports async callbacks whose promises are dropped by array methods", () => {
    ruleTester.run("no-async-array-callbacks", rule, {
      valid: [
        { code: "const ids = items.map((item) => item.id);" },
        { code: "await Promise.all(files.map(async (file) => read(file)));" },
        {
          code: "function load(files) { return Promise.allSettled(files.map(async function (file) { return read(file); })); }",
        },
        {
          code: [
            "async function load(files) {",
            "  const tasks = files.map(async (file) => read(file));",
            "  await Promise.any(tasks);",
            "}",
          ].join("\n"),
        },
        {
          code: [
            "async function load(files) {",
            "  for (const file of files) {",
            "    await read(file);",
            "  }",
            "}",
          ].join("\n"),
        },
      ],
      invalid: [
        {
          code: "files.forEach(async (file) => { await write(file); });",
          errors: [{ messageId: "droppedPromise" }],
        },
        {
          code: "const visible = items.filter(async (item) => allowed(item));",
          errors: [{ messageId: "asyncPredicate" }],
        },
        {
          code: "const found = items.find(async (item) => allowed(item));",
          errors: [{ messageId: "asyncPredicate" }],
        },
        {
          code: "const total = items.reduce(async (sum, item) => sum + await value(item), 0);",
          errors: [{ messageId: "asyncReduce" }],
        },
        {
          code: "files.map(async (file) => read(file));",
          errors: [{ messageId: "asyncMap" }],
        },
        {
          code: [
            "async function load(files) {",
            "  const tasks = files.map(async (file) => read(file));",
            "  return tasks;",
            "}",
          ].join("\n"),
          errors: [{ messageId: "asyncMap" }],
        },
      ],
    });
  });
});
