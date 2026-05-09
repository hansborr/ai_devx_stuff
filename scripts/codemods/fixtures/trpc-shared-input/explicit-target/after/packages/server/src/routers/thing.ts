import { createInputSchema } from "@musi/shared/schemas/custom.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure.input(createInputSchema).mutation(() => null),
});
