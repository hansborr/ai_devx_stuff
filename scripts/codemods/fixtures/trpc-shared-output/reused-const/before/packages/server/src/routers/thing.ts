import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

const thingResultSchema = z.object({ success: z.boolean() });

export const thingRouter = router({
  create: protectedProcedure.output(thingResultSchema).mutation(() => null),
  update: protectedProcedure.output(thingResultSchema).mutation(() => null),
});
