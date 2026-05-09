import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

const createThingResponseSchema = z.object({ id: z.string(), name: z.string() }).strict();

export const thingRouter = router({
  create: protectedProcedure.output(createThingResponseSchema).mutation(() => null),
});
