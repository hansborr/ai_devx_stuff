import { getOutputSchema } from "@musi/shared/schemas/alpha.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const alphaRouter = router({
  get: protectedProcedure.output(getOutputSchema).query(() => ({ id: "alpha-1" })),
});
