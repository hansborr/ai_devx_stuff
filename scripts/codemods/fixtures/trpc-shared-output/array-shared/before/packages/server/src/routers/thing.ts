import { thingSummarySchema } from "@musi/shared/schemas/thing.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  list: protectedProcedure.output(z.array(thingSummarySchema)).query(() => []),
});
