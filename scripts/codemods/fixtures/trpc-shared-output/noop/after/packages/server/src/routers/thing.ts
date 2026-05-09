import { thingOutputSchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.output(thingOutputSchema).query(() => null),
});
