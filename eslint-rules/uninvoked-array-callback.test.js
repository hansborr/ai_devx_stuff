// @ts-check
import { describe, it } from "vitest";

import rule from "./uninvoked-array-callback.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();
const typedRuleTester = makeRuleTester({
  projectService: {
    allowDefaultProject: ["uninvoked-array-callback-fixture.ts"],
    defaultProject: "../tsconfig.json",
  },
  tsconfigRootDir: import.meta.dirname,
});
const typedFilename = "uninvoked-array-callback-fixture.ts";

describe("uninvoked-array-callback", () => {
  it("reports callbacks invoked on sparse length-only arrays", () => {
    ruleTester.run("uninvoked-array-callback", rule, {
      valid: [
        { code: "[1, 2, 3].map((value) => value * 2);" },
        { code: "Array.from({ length: 5 }, (_, index) => createRow(index));" },
        { code: "new Array(5).fill(null).map((_, index) => createRow(index));" },
        { code: "new Array(5).fill(null, 0).map((_, index) => createRow(index));" },
        { code: "[...new Array(5)].map((_, index) => createRow(index));" },
        { code: "new Array(5).find((_, index) => index === 3);" },
        { code: "new Array(5).findIndex((_, index) => index === 3);" },
        { code: "new Array(5).findLast((_, index) => index === 3);" },
        { code: "new Array(5).findLastIndex((_, index) => index === 3);" },
        { code: "new Array('a', 'b').map((value) => value.toUpperCase());" },
        { code: "collection.map((item) => item.value);" },
        { code: "Array('x').map((value) => value.toUpperCase());" },
        { code: "Array(true).map((value) => value);" },
        { code: "Array(null).map((value) => value);" },
        { code: "Array(1n).map((value) => value);" },
        { code: "Array({ id: 'row' }).map((value) => value.id);" },
        { code: "Array(() => createRow()).map((factory) => factory());" },
        { code: "Array(3.14).map((value) => value);" },
      ],
      invalid: [
        {
          code: "const rows = new Array(5).map((_, index) => createRow(index));",
          errors: [{ messageId: "uninvokedArrayCallback" }],
        },
        {
          code: "const rows = Array(5).map((_, index) => createRow(index));",
          errors: [{ messageId: "uninvokedArrayCallback" }],
        },
        {
          code: "new Array(5).fill(null, 1, 3).map((_, index) => createRow(index));",
          errors: [{ messageId: "uninvokedArrayCallback" }],
        },
        {
          code: "Array(5)['map']((_, index) => save(index));",
          errors: [{ messageId: "uninvokedArrayCallback" }],
        },
      ],
    });
    typedRuleTester.run("uninvoked-array-callback", rule, {
      valid: [
        {
          code: "const value: string = 'x'; Array(value).map((item) => item.toUpperCase());",
          filename: typedFilename,
        },
      ],
      invalid: [
        {
          code: "const count: number = 5; new Array(count).forEach((_, index) => save(index));",
          filename: typedFilename,
          errors: [{ messageId: "uninvokedArrayCallback" }],
        },
      ],
    });
  });
});
