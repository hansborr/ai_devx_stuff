import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const campaignRouter = router({
  get: protectedProcedure.input(z.object({ id: z.string() }).strict()).query(() => ({ id: "campaign-1" })),
});
