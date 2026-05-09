import { existingInputSchema } from "@musi/shared/schemas/custom-inputs.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  existing: protectedProcedure.input(existingInputSchema).query(() => null),
  create: protectedProcedure.input(z.object({ id: z.string() }).strict()).mutation(() => null),
});
