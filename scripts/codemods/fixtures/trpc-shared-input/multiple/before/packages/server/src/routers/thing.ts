import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

const updateThingInputSchema = z.object({ id: z.string(), name: z.string() }).strict();

export const thingRouter = router({
  create: protectedProcedure.input(z.object({ name: z.string() }).strict()).mutation(() => null),
  update: protectedProcedure.input(updateThingInputSchema).mutation(() => null),
});
