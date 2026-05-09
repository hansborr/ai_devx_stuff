import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const unsupportedRouter = router({
  get: protectedProcedure.output(z.union([z.string(), z.number()])).query(() => "campaign-1"),
});
