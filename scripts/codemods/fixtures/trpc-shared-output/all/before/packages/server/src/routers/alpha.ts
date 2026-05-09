import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const alphaRouter = router({
  get: protectedProcedure.output(z.object({ id: z.string() })).query(() => ({ id: "alpha-1" })),
});
