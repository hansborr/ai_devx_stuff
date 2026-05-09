import type { ExistingInput } from "@musi/shared/schemas/custom-inputs.js";
import { existingInputSchema } from "@musi/shared/schemas/custom-inputs.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  existing: protectedProcedure.input(existingInputSchema).query((): ExistingInput => ({ page: 1 })),
  create: protectedProcedure.input(z.object({ id: z.string() }).strict()).mutation(() => null),
});
