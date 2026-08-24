// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Linter } from "eslint";
import tseslint from "typescript-eslint";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./concurrency-guard.js";

const ruleTester = makeRuleTester();
const linter = new Linter();

/**
 * @type {{ cases: { name: string, filename: string, code: string, expected: { relation: string, method: string, delegate: string }[] }[] }}
 */
const nestedCorpus = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "concurrency-guard-nested-corpus.json"),
    "utf8",
  ),
);

/**
 * @type {{ cases: { name: string, filename: string, code: string, expected: { method: string, delegate: string }[] }[] }}
 */
const directCorpus = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "concurrency-guard-direct-corpus.json"),
    "utf8",
  ),
);

describe("concurrency-guard", () => {
  it("does not point the diagnostic at the broad concurrency guide", () => {
    expect(rule.meta.messages.noDirectWrite).not.toContain("docs/CONCURRENCY.md");
    expect(rule.meta.messages.noDirectWrite).toContain("ADR-0007");
  });

  it("blocks direct writes to gated Prisma delegates outside mutation helpers", () => {
    ruleTester.run("concurrency-guard", rule, {
      valid: [
        {
          filename: "packages/server/src/routers/auth.ts",
          code: "await ctx.prisma.user.update({ where: { id }, data });",
        },
        {
          filename: "packages/server/src/routers/auth.ts",
          code: [
            "const users = ctx.prisma.user;",
            "await users.update({ where: { id }, data });",
          ].join("\n"),
        },
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: "await ctx.prisma.encounterParticipant.create({ data });",
        },
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: "await tx.encounterParticipant.delete({ where: { id } });",
        },
        {
          filename: "packages/server/src/utils/character-stats-mutations.ts",
          code: "await raw.characterStats.updateMany({ where: { characterId, version }, data });",
        },
        {
          filename: "packages/server/src/utils/__type-tests__/character-stats-restrictions.ts",
          code: "await tx.characterStats.update({ where: { characterId }, data });",
        },
        {
          filename: "packages/server/src/routers/character.ts",
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  const stats = tx.characterStats;",
            "  await stats.findUnique({ where: { characterId } });",
            "});",
          ].join("\n"),
        },
      ],
      invalid: [
        {
          filename: "packages/server/src/routers/character.ts",
          code: "await ctx.prisma.characterStats.update({ where: { characterId }, data });",
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "characterStats",
                method: "update",
                suggestion:
                  "Route characterStats writes through updateCharacterStatsLocked or updateCharacterStatsLockedWithExpectedVersion in packages/server/src/utils/character-stats-mutations.ts; follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: "await ctx.prisma.encounterParticipant.update({ where: { id }, data });",
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "encounterParticipant",
                method: "update",
                suggestion:
                  "Route encounterParticipant writes through updateParticipantStatsLocked, updateParticipantStatsLockedWithExpectedVersion, or blindUpdateParticipant in packages/server/src/utils/participant-stats-mutations.ts; use blindUpdateParticipant only for documented metadata, and follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/services/rest-service.ts",
          code: "await tx.encounter.updateMany({ where: { id }, data });",
          // Pin the descriptor-selected {{suggestion}} so generated policy
          // drift fails this case.
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "encounter",
                method: "updateMany",
                suggestion:
                  "Route encounter writes through advanceTurnCompound, setEncounterState, setCurrentTurnIndex, assertTurnLock, or updateEncounterMeta in packages/server/src/utils/encounter-state-mutations.ts; follow docs/CONCURRENCY.md#pattern-c--compound-updatemany-with-the-precondition-in-where.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/spell-slot.ts",
          code: 'await raw["characterSpellSlot"].upsert({ where, create, update });',
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "characterSpellSlot",
                method: "upsert",
                suggestion:
                  "Use consumeSpellSlot or recoverSpellSlot from packages/server/src/utils/spell-slot-mutations.ts for characterSpellSlot writes, and use the documented slot-sync helpers for synchronization flows; follow docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/services/level-up/core.ts",
          code: [
            "const { characterClass } = tx;",
            "await characterClass.update({ where: { id }, data });",
          ].join("\n"),
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "characterClass",
                method: "update",
                suggestion:
                  "Use spendHitDice, advanceClassLevel, or setSubclass from packages/server/src/utils/character-class-mutations.ts for characterClass writes, and use the documented rest helpers for rest flows; follow docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
              },
            },
          ],
        },
      ],
    });
  });

  it("does not point the nested diagnostic at the broad concurrency guide", () => {
    expect(rule.meta.messages.noNestedWrite).not.toContain("docs/CONCURRENCY.md");
    expect(rule.meta.messages.noNestedWrite).toContain("ADR-0007");
  });

  it("matches the shared direct-write corpus the codemod is also run against", () => {
    expect(directCorpus.cases, "shared direct-write corpus").not.toHaveLength(0);

    for (const entry of directCorpus.cases) {
      const messages = linter
        .verify(
          entry.code,
          {
            files: ["**/*.ts"],
            languageOptions: {
              parser: tseslint.parser,
              parserOptions: { ecmaVersion: 2022, sourceType: "module" },
            },
            plugins: { local: { rules: { "concurrency-guard": rule } } },
            rules: { "local/concurrency-guard": "error" },
          },
          entry.filename,
        )
        .filter((message) => message.messageId === "noDirectWrite");

      expect(
        messages.map((message) => message.message),
        entry.name,
      ).toEqual(
        entry.expected.map((expected) =>
          expect.stringContaining(`direct ${expected.delegate}.${expected.method} writes`),
        ),
      );
    }
  });

  it("blocks nested relation writes that reach gated tables through a non-gated parent", () => {
    ruleTester.run("concurrency-guard", rule, {
      valid: [
        {
          // Nested `create` is deliberately outside the gate: ordinary
          // character creation writes these relations.
          filename: "packages/server/src/routers/character.ts",
          code: "await ctx.prisma.character.create({ data: { stats: { create: { maxHp: 10 } } } });",
        },
        {
          // `MapToken` owns this FK, so connect does not write the gated row.
          filename: "packages/server/src/routers/map-token.ts",
          code: "await ctx.prisma.mapToken.update({ where: { id }, data: { encounterParticipant: { connect: { id: pid } } } });",
        },
        {
          // Deliberate v1 non-goal: `CharacterClass` owns this FK, so this does
          // write the gated row, but connect/disconnect/set stay outside the
          // operation gate pending a separate blast-radius decision.
          filename: "packages/server/src/routers/character.ts",
          code: "await ctx.prisma.character.update({ where: { id }, data: { classes: { connect: { id: classId } } } });",
        },
        {
          // A relation name that reaches no gated model.
          filename: "packages/server/src/routers/campaign.ts",
          code: "await ctx.prisma.campaign.update({ where: { id }, data: { members: { updateMany: { where: {}, data } } } });",
        },
        {
          // Scalar assignment on a same-named field, not a nested payload.
          filename: "packages/server/src/routers/character.ts",
          code: "await ctx.prisma.character.update({ where: { id }, data: { stats: undefined } });",
        },
        {
          // Ordinary server objects that pair a relation name with an `update`
          // key are not Prisma nested-write payloads. This is the exact shape
          // the branch's first cut mis-flagged: the payload is a plain object
          // literal that never reaches a Prisma mutation.
          filename: "packages/server/src/services/character-live-state/mapping.ts",
          code: "const handlers = { stats: { update: { currentHp: 0 } } };",
        },
        {
          // Same shape, passed to a non-Prisma `update` method. Prisma's
          // update/updateMany/upsert argument always carries `where`; without
          // it there is no mutation to route through a helper.
          filename: "packages/server/src/services/character-live-state/mapping.ts",
          code: "await store.update({ data: { stats: { update: { currentHp: 0 } } } });",
        },
        {
          // Destructuring, not a payload.
          filename: "packages/server/src/routers/character.ts",
          code: "const { stats: { update } } = snapshot;",
        },
        {
          // `Spell.classes` is a `Json` scalar, not the `CharacterClass`
          // relation of the same name on `Character`. Matching the relation key
          // without its parent model made this type-valid JSON write a hard
          // error — and the drift test's collision guard could not see it,
          // because it only compares relation fields to relation fields.
          filename: "packages/server/src/routers/srd.ts",
          code: "await ctx.prisma.spell.update({ where: { id }, data: { classes: { update: { a: 1 } } } });",
        },
        {
          // `Notification.data` is arbitrary JSON. Keys inside it can spell a
          // real relation path and Prisma envelope without becoming a nested
          // relation write; reporting this type-valid payload would turn an
          // author-time diagnostic into a production-blocking false positive.
          filename: "packages/server/src/routers/notification.ts",
          code: [
            "const metadata = { user: { update: { data: { campaignMembers: { update: { data: { character: { update: { data: { stats: { update: { currentHp: 0 } } } } } } } } } } } };",
            "await ctx.prisma.notification.update({ where: { id }, data: { data: metadata } });",
          ].join("\n"),
        },
        {
          // A non-Prisma `.update({ where, ... })` API. Rooting on the receiver
          // model is what keeps this out; the `where` key alone did not.
          filename: "packages/server/src/services/character-live-state/mapping.ts",
          code: "await store.update({ where: { id }, data: { stats: { update: { currentHp: 0 } } } });",
        },
        {
          // A computed relation key names nothing static, so there is no
          // relation to look up. Same treatment the ESTree `Property` node
          // already gets from `staticKeyName`.
          filename: "packages/server/src/routers/character.ts",
          code: "await tx.character.update({ where: { id }, data: { [relation]: { update: { currentHp: 0 } } } });",
        },
      ],
      invalid: [
        {
          // The generated reachable graph keeps model identity across the
          // non-gated CampaignMember.character hop. The former flat table
          // dropped it.
          filename: "packages/server/src/routers/campaign.ts",
          code: "await tx.campaignMember.update({ where: { id }, data: { character: { update: { data: { stats: { update: { currentHp: 0 } } } } } } });",
          errors: [{ messageId: "noNestedWrite" }],
        },
        {
          // Parent-model rooting and receiver-alias resolution are independent.
          // Requiring a literal member expression conflated them and let one
          // local binding defeat the author-time diagnostic on this path.
          filename: "packages/server/src/routers/character.ts",
          code: "const chars = tx.character; await chars.update({ where: { id }, data: { stats: { update: { currentHp: 0 } } } });",
          errors: [{ messageId: "noNestedWrite" }],
        },
        {
          filename: "packages/server/src/routers/character.ts",
          code: "const { character } = tx; await character.update({ where: { id }, data: { stats: { update: { currentHp: 0 } } } });",
          errors: [{ messageId: "noNestedWrite" }],
        },
        {
          // A quoted key is ordinary TypeScript, not evasion, and a computed
          // string literal denotes the same property as the dotted form.
          filename: "packages/server/src/routers/character.ts",
          code: 'await tx["character"]["update"]({ where: { id }, data: { "stats": { update: { currentHp: 0 } } } });',
          errors: [{ messageId: "noNestedWrite" }],
        },
        {
          // Array elements get the same one-hop `const` resolution the scalar
          // form does; Prisma accepts both spellings of `updateMany`.
          filename: "packages/server/src/services/rest-service.ts",
          code: "const reset = { where: { id: classId }, data: { hitDiceUsed: 0 } }; await tx.character.update({ where: { id }, data: { classes: { updateMany: [reset] } } });",
          errors: [{ messageId: "noNestedWrite" }],
        },
        {
          // The disclosed cost of rooting on a name: a receiver spelled exactly
          // like a Prisma call — model name, relation name, gated mutator and a
          // `where` key — cannot be told apart from one without type
          // information, and is reported rather than guessed past.
          filename: "packages/server/src/services/character-live-state/mapping.ts",
          code: "await repository.character.update({ where: { id }, data: { stats: { update: { currentHp: 0 } } } });",
          errors: [{ messageId: "noNestedWrite" }],
        },
        {
          filename: "packages/server/src/routers/character.ts",
          code: "await tx.character.update({ where: { id }, data: { stats: { update: { currentHp: 0 } } } });",
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "characterStats",
                relation: "stats",
                method: "update",
                suggestion:
                  "Route characterStats writes through updateCharacterStatsLocked or updateCharacterStatsLockedWithExpectedVersion in packages/server/src/utils/character-stats-mutations.ts; follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/campaign.ts",
          code: "await tx.campaign.update({ where: { id }, data: { encounters: { updateMany: { where: {}, data: { round: 99 } } } } });",
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "encounter",
                relation: "encounters",
                method: "updateMany",
                suggestion:
                  "Route encounter writes through advanceTurnCompound, setEncounterState, setCurrentTurnIndex, assertTurnLock, or updateEncounterMeta in packages/server/src/utils/encounter-state-mutations.ts; follow docs/CONCURRENCY.md#pattern-c--compound-updatemany-with-the-precondition-in-where.",
              },
            },
          ],
        },
        {
          // `MapToken.encounterParticipant` — a singular relation the leaf's
          // proposed name list missed; the set is derived from the schema.
          filename: "packages/server/src/routers/map-token.ts",
          code: "await tx.mapToken.update({ where: { id }, data: { encounterParticipant: { update: { currentHp: 0 } } } });",
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "encounterParticipant",
                relation: "encounterParticipant",
                method: "update",
                suggestion:
                  "Route encounterParticipant writes through updateParticipantStatsLocked, updateParticipantStatsLockedWithExpectedVersion, or blindUpdateParticipant in packages/server/src/utils/participant-stats-mutations.ts; use blindUpdateParticipant only for documented metadata, and follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/services/level-up/core.ts",
          code: "await tx.character.update({ where: { id }, data: { classes: { updateMany: { where: {}, data: { level: 20 } } }, spellSlots: { updateMany: { where: {}, data: { used: 0 } } } } });",
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "characterClass",
                relation: "classes",
                method: "updateMany",
                suggestion:
                  "Use spendHitDice, advanceClassLevel, or setSubclass from packages/server/src/utils/character-class-mutations.ts for characterClass writes, and use the documented rest helpers for rest flows; follow docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
              },
            },
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "characterSpellSlot",
                relation: "spellSlots",
                method: "updateMany",
                suggestion:
                  "Use consumeSpellSlot or recoverSpellSlot from packages/server/src/utils/spell-slot-mutations.ts for characterSpellSlot writes, and use the documented slot-sync helpers for synchronization flows; follow docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
              },
            },
          ],
        },
        {
          // Two levels deep: the parent of the gated relation is itself nested.
          filename: "packages/server/src/routers/campaign.ts",
          code: "await tx.campaign.update({ where: { id }, data: { encounters: { update: { data: { participants: { updateMany: { where: {}, data } } } } } } });",
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "encounter",
                relation: "encounters",
                method: "update",
                suggestion:
                  "Route encounter writes through advanceTurnCompound, setEncounterState, setCurrentTurnIndex, assertTurnLock, or updateEncounterMeta in packages/server/src/utils/encounter-state-mutations.ts; follow docs/CONCURRENCY.md#pattern-c--compound-updatemany-with-the-precondition-in-where.",
              },
            },
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "encounterParticipant",
                relation: "participants",
                method: "updateMany",
                suggestion:
                  "Route encounterParticipant writes through updateParticipantStatsLocked, updateParticipantStatsLockedWithExpectedVersion, or blindUpdateParticipant in packages/server/src/utils/participant-stats-mutations.ts; use blindUpdateParticipant only for documented metadata, and follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          // The payload is built into a `const` and passed by name. A pure
          // key-matching branch would miss this; the binding is followed the
          // same way the direct-call branch follows delegate aliases.
          filename: "packages/server/src/routers/character.ts",
          code: [
            "const statsWrite = { update: { currentHp: 0 } };",
            "await tx.character.update({ where: { id }, data: { stats: statsWrite } });",
          ].join("\n"),
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "characterStats",
                relation: "stats",
                method: "update",
                suggestion:
                  "Route characterStats writes through updateCharacterStatsLocked or updateCharacterStatsLockedWithExpectedVersion in packages/server/src/utils/character-stats-mutations.ts; follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          // The *mutator* value is bound too, not just the relation envelope.
          // `update: patch` was the cheapest way past the first cut of this
          // branch, and it is ordinary code rather than an evasion.
          filename: "packages/server/src/routers/character.ts",
          code: [
            "const patch = { currentHp: 0 };",
            "await tx.character.update({ where: { id }, data: { stats: { update: patch } } });",
          ].join("\n"),
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "characterStats",
                relation: "stats",
                method: "update",
                suggestion:
                  "Route characterStats writes through updateCharacterStatsLocked or updateCharacterStatsLockedWithExpectedVersion in packages/server/src/utils/character-stats-mutations.ts; follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          // The whole argument object is bound.
          filename: "packages/server/src/routers/character.ts",
          code: [
            "const args = { where: { id }, data: { stats: { update: { currentHp: 0 } } } };",
            "await tx.character.update(args);",
          ].join("\n"),
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "characterStats",
                relation: "stats",
                method: "update",
                suggestion:
                  "Route characterStats writes through updateCharacterStatsLocked or updateCharacterStatsLockedWithExpectedVersion in packages/server/src/utils/character-stats-mutations.ts; follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          // Mutation helpers are exempt from the *direct* branch because they
          // own the RawTxClient boundary for one table. That exemption must not
          // extend to nested writes: a single-table helper reaching a gated
          // table through a non-gated parent escapes its own boundary.
          filename: "packages/server/src/utils/character-stats-mutations.ts",
          code: "await raw.character.update({ where: { id }, data: { stats: { update: { currentHp } } } });",
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "characterStats",
                relation: "stats",
                method: "update",
                suggestion:
                  "Route characterStats writes through updateCharacterStatsLocked or updateCharacterStatsLockedWithExpectedVersion in packages/server/src/utils/character-stats-mutations.ts; follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
        {
          // ...including a reach into a *different* gated table than the one
          // the helper file owns.
          filename: "packages/server/src/utils/character-stats-mutations.ts",
          code: "await raw.encounter.update({ where: { id }, data: { participants: { updateMany: { where: {}, data } } } });",
          errors: [
            {
              messageId: "noNestedWrite",
              data: {
                delegate: "encounterParticipant",
                relation: "participants",
                method: "updateMany",
                suggestion:
                  "Route encounterParticipant writes through updateParticipantStatsLocked, updateParticipantStatsLockedWithExpectedVersion, or blindUpdateParticipant in packages/server/src/utils/participant-stats-mutations.ts; use blindUpdateParticipant only for documented metadata, and follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
              },
            },
          ],
        },
      ],
    });
  });

  it("matches the lint-only nested-write regression corpus", () => {
    expect(nestedCorpus.cases, "nested-write regression corpus").toHaveLength(45);

    for (const entry of nestedCorpus.cases) {
      const messages = linter
        .verify(
          entry.code,
          {
            files: ["**/*.ts"],
            languageOptions: {
              parser: tseslint.parser,
              parserOptions: { ecmaVersion: 2022, sourceType: "module" },
            },
            plugins: { local: { rules: { "concurrency-guard": rule } } },
            rules: { "local/concurrency-guard": "error" },
          },
          entry.filename,
        )
        .filter((message) => message.messageId === "noNestedWrite");

      expect(
        messages.map((message) => message.message),
        entry.name,
      ).toEqual(
        entry.expected.map((expected) =>
          expect.stringContaining(
            `\`${expected.relation}: {${expected.method}: ...}\` payload writes ${expected.delegate} `,
          ),
        ),
      );
    }
  });
});
