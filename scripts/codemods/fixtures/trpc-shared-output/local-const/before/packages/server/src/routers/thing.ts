import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

const updateThingResultSchema = z.object({ id: z.string(), name: z.string() });

export const thingRouter = router({
  update: protectedProcedure.output(updateThingResultSchema).mutation(() => null),
});
