import { thingOutputSchema } from "@musi/shared/schemas/thing.js";
import { createInputSchema } from "@musi/shared/schemas/thing-inputs.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure
    .input(createInputSchema)
    .output(thingOutputSchema)
    .mutation(() => null),
});
