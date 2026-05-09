import type { RawTxClient, TxClient } from "./prisma-types.js";

export async function resetAllHitDice(tx: TxClient, characterId: string): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  await raw.characterClass.upsert({
    where: { id: characterId },
    create: { characterId, classId: "fighter", level: 1 },
    update: {},
  });
}
