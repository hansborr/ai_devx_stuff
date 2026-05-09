import { type OtherSummary } from "@musi/shared/schemas/other.js";
import { listOutputSchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  list: protectedProcedure.output(listOutputSchema).query((): OtherSummary[] => []),
});
