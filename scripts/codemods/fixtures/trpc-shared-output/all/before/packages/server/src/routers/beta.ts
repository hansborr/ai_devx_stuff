import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const betaRouter = router({
  list: protectedProcedure.output(z.object({ ids: z.array(z.string()) })).query(() => ({ ids: [] })),
});
