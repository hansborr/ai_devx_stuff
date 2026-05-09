import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  remove: protectedProcedure.output(z.object({ success: z.boolean() })).mutation(() => ({ success: true })),
});
