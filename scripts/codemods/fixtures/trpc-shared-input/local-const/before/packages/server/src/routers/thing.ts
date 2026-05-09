import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

const updateThingInputSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .strict();

export const thingRouter = router({
  update: protectedProcedure.input(updateThingInputSchema).mutation(() => null),
});
