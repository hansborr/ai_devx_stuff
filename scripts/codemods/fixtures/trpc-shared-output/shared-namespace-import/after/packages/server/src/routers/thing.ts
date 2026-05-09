import * as sharedSchemas from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.output(sharedSchemas.thingOutputSchema).query(() => null),
});
