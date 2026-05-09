import type { DbClient } from "../utils/prisma-types.js";

export async function unsafeStatsUpdate(db: DbClient, characterId: string): Promise<void> {
  await db.characterStats.updateManyAndReturn({
    where: { characterId },
    data: { currentHp: 5 },
  });
}
