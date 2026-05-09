import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const campaignRouter = router({
  get: protectedProcedure.output(z.object({ id: z.string() })).query(() => ({ id: "campaign-1" })),
});
