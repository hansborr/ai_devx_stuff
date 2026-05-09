import { listOutputSchema } from "@musi/shared/schemas/admin/thing.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  list: protectedProcedure.output(listOutputSchema).query(() => []),
});
