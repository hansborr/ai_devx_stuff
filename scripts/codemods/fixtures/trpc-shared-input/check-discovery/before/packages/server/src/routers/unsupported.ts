import { baseInputSchema } from "@musi/shared/schemas/campaign-inputs.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const unsupportedRouter = router({
  get: protectedProcedure.input(baseInputSchema.extend({ serverOnly: z.string() })).query(() => ({ id: "campaign-1" })),
});
