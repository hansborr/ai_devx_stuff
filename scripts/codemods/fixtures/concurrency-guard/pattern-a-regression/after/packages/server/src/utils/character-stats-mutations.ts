import { TRPCError } from "@trpc/server";

import type { CharacterStats, Prisma } from "../generated/prisma/client.js";
import type { RawTxClient, TxClient } from "./prisma-types.js";

export async function updateCharacterStatsLocked(
  tx: TxClient,
  characterId: string,
  mutator: (stats: CharacterStats) => Prisma.CharacterStatsUpdateManyMutationInput,
): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  const stats = await raw.characterStats.findUnique({ where: { characterId } });
  if (!stats) throw new TRPCError({ code: "NOT_FOUND", message: "Missing" });
  await raw.characterStats.updateMany({
    where: { characterId },
    data: mutator(stats),
  });
}
