// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-barrel.js";

const ruleTester = makeRuleTester();

describe("no-barrel", () => {
  it("flags index files that re-export from sibling modules", () => {
    ruleTester.run("no-barrel", rule, {
      valid: [
        {
          filename: "packages/server/src/socket/index.ts",
          code: `
            import { Server } from "socket.io";
            export type AppSocketServer = Server;
            export function setupSocketIO() {
              return new Server();
            }
          `,
        },
        {
          filename: "packages/shared/src/rules/character-rules.ts",
          code: 'export * from "./multiclass-rules.js";',
        },
        {
          filename: "packages/server/src/services/feature/index.ts",
          code: "export interface LocalType { readonly id: string; }",
        },
        {
          filename: "packages/server/src/socket/index.ts",
          code: `
            const socketVersion = "1";
            export { socketVersion };
          `,
        },
      ],
      invalid: [
        {
          filename: "packages/shared/src/rules/index.ts",
          code: 'export * from "./character-rules.js";',
          errors: [{ messageId: "noBarrel" }],
        },
        {
          filename: "packages/shared/src/dice/index.ts",
          code: 'export { parseDiceNotation } from "./dice-notation.js";',
          errors: [{ messageId: "noBarrel" }],
        },
        {
          filename: "packages/shared/src/dice/index.ts",
          code: 'export type { RollResult } from "./dice-roller.js";',
          errors: [{ messageId: "noBarrel" }],
        },
        {
          filename: "packages/server/src/services/encounter-combat/index.ts",
          code: `
            export interface CombatActionContext {
              readonly userId: string;
            }
            export { attemptAttack } from "./attack-action.js";
          `,
          errors: [{ messageId: "noBarrel" }],
        },
        {
          filename: "packages/shared/src/rules/index.ts",
          code: `
            import { normalizeScore } from "./ability.js";
            export { normalizeScore };
          `,
          errors: [{ messageId: "noBarrel" }],
        },
        {
          filename: "packages/shared/src/rules/index.ts",
          code: `
            import type { AbilityScores } from "./character-rules.js";
            export type { AbilityScores };
          `,
          errors: [{ messageId: "noBarrel" }],
        },
      ],
    });
  });
});
