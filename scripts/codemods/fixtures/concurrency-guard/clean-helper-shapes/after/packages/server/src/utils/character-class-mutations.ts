import { TRPCError } from "@trpc/server";

import type { RawTxClient, TxClient } from "./prisma-types.js";

export async function advanceClassLevel(
  tx: TxClient,
  characterClassRecordId: string,
  previousLevel: number,
  newLevel: number,
): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  const result = await raw.characterClass.updateMany({
    where: { id: characterClassRecordId, level: previousLevel },
    data: { level: newLevel },
  });
  if (result.count === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "Class level modified concurrently" });
  }
}

export async function resetAllHitDice(tx: TxClient, characterId: string): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  await raw.characterClass.updateMany({
    where: { characterId },
    data: { hitDiceUsed: 0 },
  });
}
