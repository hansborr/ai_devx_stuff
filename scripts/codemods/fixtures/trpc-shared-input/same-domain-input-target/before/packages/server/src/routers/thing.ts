import { existingInputSchema, thingOutputSchema } from "@musi/shared/schemas/thing.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  existing: protectedProcedure.input(existingInputSchema).query(() => null),
  create: protectedProcedure
    .input(z.object({ id: z.string() }).strict())
    .output(thingOutputSchema)
    .mutation(() => null),
});
