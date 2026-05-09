import { z } from "zod";

const keepMe = z.string();

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure
    .input(z.object({ id: z.string() }).strict())
    .mutation(() => keepMe),
});
