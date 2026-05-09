import { createInputSchema, updateThingInputSchema } from "@musi/shared/schemas/thing-inputs.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure.input(createInputSchema).mutation(() => null),
  update: protectedProcedure.input(updateThingInputSchema).mutation(() => null),
});
