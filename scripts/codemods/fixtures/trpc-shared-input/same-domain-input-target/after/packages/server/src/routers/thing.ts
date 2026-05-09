import { createInputSchema, existingInputSchema, thingOutputSchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  existing: protectedProcedure.input(existingInputSchema).query(() => null),
  create: protectedProcedure
    .input(createInputSchema)
    .output(thingOutputSchema)
    .mutation(() => null),
});
