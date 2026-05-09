import { createThingResponseSchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure.output(createThingResponseSchema).mutation(() => null),
});
