// @ts-check
import { describe, expect, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./trpc-shared-output-schema.js";

const ruleTester = makeRuleTester();

describe("trpc-shared-output-schema", () => {
  it("names the shared-schema boundary decision", () => {
    expect(rule.meta.messages.needsSharedOutput).toContain("ADR-0004");
  });

  it("runs", () => {
    const expectedMessage = /bun run codemod:trpc-shared-output -- <file>/u;

    ruleTester.run("trpc-shared-output-schema", rule, {
      valid: [
        {
          code: `
            import { campaignDetailSchema } from "@musi/shared/schemas/campaign.js";
            p.output(campaignDetailSchema);
          `,
        },
        {
          code: `
            import { campaignDetailSchema as outputSchema } from "@musi/shared/schemas/campaign.js";
            p.output(outputSchema);
          `,
        },
      ],
      invalid: [
        {
          code: `
            import { z } from "zod";
            p.output(z.object({ success: z.boolean() }));
          `,
          errors: [{ message: expectedMessage }],
        },
        {
          code: `
            import { z } from "zod";
            p.output(z.array(characterSummarySchema));
          `,
          errors: [{ messageId: "needsSharedOutput" }],
        },
        {
          code: `
            const localOutputSchema = z.object({ id: z.string() });
            p.output(localOutputSchema);
          `,
          errors: [{ messageId: "needsSharedOutput" }],
        },
        {
          code: `
            import { localOutputSchema } from "../schemas/local.js";
            p.output(localOutputSchema);
          `,
          errors: [{ messageId: "needsSharedOutput" }],
        },
        {
          code: `
            import * as sharedSchemas from "@musi/shared/schemas/campaign.js";
            p.output(sharedSchemas.campaignDetailSchema);
          `,
          errors: [{ messageId: "needsSharedOutput" }],
        },
        {
          code: `
            import { campaignDetailSchema } from "@musi/shared/schemas/campaign.js";
            p.output(campaignDetailSchema.array());
          `,
          errors: [{ messageId: "needsSharedOutput" }],
        },
        {
          code: `
            import { campaignDetailSchema } from "@musi/shared/schemas/campaign.js";
            p.output(campaignDetailSchema.describe("campaign detail"));
          `,
          errors: [{ messageId: "needsSharedOutput" }],
        },
      ],
    });
  });
});
