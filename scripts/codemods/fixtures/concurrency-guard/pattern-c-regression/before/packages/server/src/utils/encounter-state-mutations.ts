import type { RawTxClient, TxClient } from "./prisma-types.js";

export async function advanceTurnCompound(tx: TxClient, encounterId: string): Promise<number> {
  const raw = tx as unknown as RawTxClient;
  const result = await raw.encounter.updateMany({
    where: { id: encounterId, state: "active" },
    data: { currentTurnIndex: 1, round: 2 },
  });
  return result.count;
}
