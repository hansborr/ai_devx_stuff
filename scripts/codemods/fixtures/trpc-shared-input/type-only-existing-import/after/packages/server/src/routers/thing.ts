import type { ExistingInput } from "@musi/shared/schemas/custom-inputs.js";
import { createInputSchema, existingInputSchema } from "@musi/shared/schemas/custom-inputs.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  existing: protectedProcedure.input(existingInputSchema).query((): ExistingInput => ({ page: 1 })),
  create: protectedProcedure.input(createInputSchema).mutation(() => null),
});
