import { localOutputSchema } from "../schemas/local.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.output(localOutputSchema).query(() => null),
});
