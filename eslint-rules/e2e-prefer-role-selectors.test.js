// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./e2e-prefer-role-selectors.js";

const ruleTester = makeRuleTester();

describe("e2e-prefer-role-selectors", () => {
  it("runs", () => {
    const expectedMessage = /docs\/guides\/add-e2e-test\.md/u;

    ruleTester.run("e2e-prefer-role-selectors", rule, {
      valid: [
        { code: "page.getByRole('button', { name: 'Save' }).click()" },
        { code: "page.getByLabel('Character name').fill(name)" },
        { code: "page.getByText('Ready').click()" },
        { code: "page.getByTestId('spell-card').click()" },
      ],
      invalid: [
        {
          code: "page.locator('.spell-card').click()",
          errors: [{ message: expectedMessage }],
        },
        {
          code: "const button = savedLocator.locator('button')",
          errors: [{ messageId: "preferRoleSelectors" }],
        },
        {
          code: "await this.page.locator('[aria-label=\"Save\"]').click()",
          errors: [{ messageId: "preferRoleSelectors" }],
        },
      ],
    });
  });
});
