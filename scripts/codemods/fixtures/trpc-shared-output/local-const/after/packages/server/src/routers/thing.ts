import { updateThingResultSchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  update: protectedProcedure.output(updateThingResultSchema).mutation(() => null),
});
