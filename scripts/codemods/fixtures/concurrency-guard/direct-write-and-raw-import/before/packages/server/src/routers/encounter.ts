import type { RawTxClient, TxClient } from "../utils/prisma-types.js";

export async function updateParticipant(tx: TxClient, participantId: string): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  await raw.encounterParticipant.updateMany({
    where: { id: participantId },
    data: { currentHp: 10 },
  });
}
