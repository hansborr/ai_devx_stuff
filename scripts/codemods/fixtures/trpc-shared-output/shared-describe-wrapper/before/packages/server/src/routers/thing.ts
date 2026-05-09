import { thingSummarySchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.output(thingSummarySchema.describe("thing summary")).query(() => null),
});
