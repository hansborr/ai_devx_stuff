import { removeOutputSchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  remove: protectedProcedure.output(removeOutputSchema).mutation(() => ({ success: true })),
});
