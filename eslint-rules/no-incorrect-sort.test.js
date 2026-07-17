// @ts-check
import { describe, it } from "vitest";

import rule from "./no-incorrect-sort.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();
const typedRuleTester = makeRuleTester({
  projectService: {
    allowDefaultProject: ["no-incorrect-sort-fixture.ts"],
    defaultProject: "../tsconfig.json",
  },
  tsconfigRootDir: import.meta.dirname,
});
const typedFilename = "no-incorrect-sort-fixture.ts";

describe("no-incorrect-sort", () => {
  it("reports Array sorts that omit a comparator", () => {
    ruleTester.run("no-incorrect-sort", rule, {
      valid: [
        { code: "nums.sort((left, right) => left - right);" },
        { code: "names.sort((left, right) => left.localeCompare(right));" },
        { code: "['mage', 'bard'].sort();" },
        { code: "unknownItems.sort();" },
        { code: "items.sort(compareItems).map(normalize);" },
        { code: "items?.sort((left, right) => left.rank - right.rank);" },
        { code: "new Int32Array([10, 2, 1]).sort();" },
        { code: "new Float64Array(data).sort();" },
        { code: "new Uint8Array(bytes).sort();" },
      ],
      invalid: [
        { code: "[10, 2, 1].sort();", errors: [{ messageId: "noIncorrectSort" }] },
        { code: "[3, 20].sort(undefined);", errors: [{ messageId: "noIncorrectSort" }] },
        { code: "[3, 20].sort(void 0);", errors: [{ messageId: "noIncorrectSort" }] },
        { code: "[3, 20]['sort']();", errors: [{ messageId: "noIncorrectSort" }] },
      ],
    });

    typedRuleTester.run("no-incorrect-sort", rule, {
      valid: [
        {
          code: "declare const custom: { [index: number]: number; sort(): void }; custom.sort();",
          filename: typedFilename,
        },
        {
          code: "const values: Int32Array = new Int32Array([10, 2, 1]); values.sort();",
          filename: typedFilename,
        },
      ],
      invalid: [
        {
          code: "const values: number[] = [10, 2, 1]; values.sort();",
          filename: typedFilename,
          errors: [{ messageId: "noIncorrectSort" }],
        },
        {
          code: "const values: bigint[] = [10n, 2n, 1n]; values.sort();",
          filename: typedFilename,
          errors: [{ messageId: "noIncorrectBigIntSort" }],
        },
      ],
    });
  });
});
