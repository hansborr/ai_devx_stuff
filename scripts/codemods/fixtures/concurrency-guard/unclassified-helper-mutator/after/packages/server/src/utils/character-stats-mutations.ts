import type { RawTxClient, TxClient } from "./prisma-types.js";

export async function replaceStats(tx: TxClient, characterId: string): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  await raw.characterStats.upsert({
    where: { characterId },
    create: { characterId },
    update: { currentHp: 5 },
  });
}
