import "./setup.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure
    .input(z.object({ id: z.string() }).strict())
    .mutation(() => null),
});
