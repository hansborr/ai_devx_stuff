import { z } from "zod";

const keepMe = z.string();

import { createInputSchema } from "@musi/shared/schemas/thing-inputs.js";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure
    .input(createInputSchema)
    .mutation(() => keepMe),
});
