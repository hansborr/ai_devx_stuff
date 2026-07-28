import type { TxClient } from "../utils/prisma-types.js";

// Nested relation writes: the parent delegates (`character`, `campaign`) are
// not gated, so neither the branded types nor the direct-call check sees these.
export async function unsafeNestedWrites(tx: TxClient, id: string): Promise<void> {
  await tx.character.update({
    where: { id },
    data: { stats: { update: { currentHp: 0 } } },
  });
  await tx.campaign.update({
    where: { id },
    data: { encounters: { updateMany: { where: {}, data: { round: 99 } } } },
  });
  // Nested `create` is outside the gate and must not be flagged.
  await tx.character.create({
    data: { spellSlots: { create: { spellLevel: 1, total: 2, used: 0 } } },
  });
}
