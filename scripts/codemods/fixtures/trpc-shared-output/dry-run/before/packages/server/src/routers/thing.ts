import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure.output(z.object({ success: z.boolean() })).mutation(() => null),
});
