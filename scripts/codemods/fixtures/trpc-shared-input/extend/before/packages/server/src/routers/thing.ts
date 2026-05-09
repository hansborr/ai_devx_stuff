import { baseInputSchema } from "@musi/shared/schemas/thing-inputs.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure.input(baseInputSchema.extend({ id: z.string() })).mutation(() => null),
});
