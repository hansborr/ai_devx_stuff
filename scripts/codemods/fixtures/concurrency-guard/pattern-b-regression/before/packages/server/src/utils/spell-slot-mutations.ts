import type { RawTxClient, TxClient } from "./prisma-types.js";

export async function consumeSpellSlot(tx: TxClient, slotId: string): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  const result = await raw.characterSpellSlot.updateMany({
    where: { id: slotId },
    data: { used: { increment: 1 } },
  });
  if (result.count === 0) return;
}
