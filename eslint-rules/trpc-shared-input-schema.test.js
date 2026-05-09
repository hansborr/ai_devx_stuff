// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./trpc-shared-input-schema.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("trpc-shared-input-schema", () => {
  it("runs", () => {
    const expectedMessage = /bun run codemod:trpc-shared-input -- <file>/u;

    ruleTester.run("trpc-shared-input-schema", rule, {
      valid: [
        {
          code: `
            import { getCampaignInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
            p.input(getCampaignInputSchema);
          `,
        },
        {
          code: `
            import { listCollectionsInputSchema } from "@musi/shared/schemas/homebrew-inputs.js";
            p.input(listCollectionsInputSchema.optional());
          `,
        },
        {
          code: `
            import { listSpellsInputSchema } from "@musi/shared/schemas/spell.js";
            p.input(listSpellsInputSchema.describe("list spells").optional());
          `,
        },
      ],
      invalid: [
        {
          code: `
            import { z } from "zod";
            p.input(z.object({ id: z.string() }).strict());
          `,
          errors: [{ message: expectedMessage }],
        },
        {
          code: `
            const localInputSchema = z.object({ id: z.string() }).strict();
            p.input(localInputSchema);
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import { localInputSchema } from "../schemas/local.js";
            p.input(localInputSchema);
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import * as sharedSchemas from "@musi/shared/schemas/campaign-inputs.js";
            p.input(sharedSchemas.getCampaignInputSchema);
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import { getCampaignInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
            p.input(getCampaignInputSchema.extend({ serverOnly: z.string() }));
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import { baseInputSchema, extraInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
            p.input(baseInputSchema.merge(extraInputSchema));
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import { getCampaignInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
            p.input(getCampaignInputSchema.and(z.object({ serverOnly: z.string() }).strict()));
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import { getCampaignInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
            p.input(getCampaignInputSchema.or(z.object({ serverOnly: z.string() }).strict()));
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import { getCampaignInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
            p.input(getCampaignInputSchema.optional().extend({ serverOnly: z.string() }));
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
        {
          code: `
            import { getCampaignInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
            p.input(getCampaignInputSchema.nullable());
          `,
          errors: [{ messageId: "needsSharedInput" }],
        },
      ],
    });
  });
});
