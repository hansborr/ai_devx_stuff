import { getInputSchema } from "@musi/shared/schemas/admin/thing-inputs.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.input(getInputSchema).query(() => null),
});
