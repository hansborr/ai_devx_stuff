import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

const updateThingInputSchema = z.object({ id: z.string() }).strict();
type UpdateThingInput = z.infer<typeof updateThingInputSchema>;

export const thingRouter = router({
  update: protectedProcedure
    .input(updateThingInputSchema)
    .mutation(({ input }): UpdateThingInput => input),
});
