import { listOutputSchema } from "@musi/shared/schemas/beta.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const betaRouter = router({
  list: protectedProcedure.output(listOutputSchema).query(() => ({ ids: [] })),
});
