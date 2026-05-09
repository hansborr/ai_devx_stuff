import { createInputSchema } from "@musi/shared/schemas/thing-inputs.js";

import { protectedProcedure } from "../trpc/trpc.js";

export const create = protectedProcedure
  .input(createInputSchema)
  .mutation(() => null);
