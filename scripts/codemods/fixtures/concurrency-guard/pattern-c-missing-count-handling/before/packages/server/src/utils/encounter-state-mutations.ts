import type { RawTxClient, TxClient } from "./prisma-types.js";

export async function setEncounterState(tx: TxClient, encounterId: string): Promise<void> {
  const raw = tx as unknown as RawTxClient;
  const result = await raw.encounter.updateMany({
    where: { id: encounterId, state: "setup" },
    data: { state: "active" },
  });
  void result;
}
