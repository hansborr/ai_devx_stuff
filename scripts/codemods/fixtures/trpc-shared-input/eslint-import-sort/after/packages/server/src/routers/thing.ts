import { createInputSchema } from "@musi/shared/schemas/thing-inputs.js";

import { protectedProcedure, router } from "../trpc/trpc.js";
import "./setup.js";

export const thingRouter = router({
  create: protectedProcedure
    .input(createInputSchema)
    .mutation(() => null),
});
