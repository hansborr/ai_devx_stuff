import { z } from "zod";

const combatSpellResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("spellAttack"),
    targetParticipantId: z.string(),
    totalDamage: z.number().int().nonnegative(),
    damageRolls: z.array(z.number().int()),
    hit: z.boolean(),
  }),
  z.object({
    type: z.literal("savingThrow"),
    targetParticipantId: z.string(),
    totalDamage: z.number().int().nonnegative(),
    damageRolls: z.array(z.number().int()),
    saveDc: z.number().int(),
    saveAbility: z.enum(["STR", "DEX", "CON", "INT", "WIS", "CHA"]),
    saved: z.boolean(),
  }),
]);

const combatSpellEnvelopeSchema = z.object({
  result: z.object({ data: z.object({ spellResults: z.array(combatSpellResultSchema) }) }),
});

export type BrowserCombatSpellResponse = z.infer<
  typeof combatSpellEnvelopeSchema
>["result"]["data"];

export function readCombatSpellResponse(value: unknown): BrowserCombatSpellResponse {
  const parsed = z
    .union([combatSpellEnvelopeSchema, z.tuple([combatSpellEnvelopeSchema])])
    .parse(value);
  return Array.isArray(parsed) ? parsed[0].result.data : parsed.result.data;
}
