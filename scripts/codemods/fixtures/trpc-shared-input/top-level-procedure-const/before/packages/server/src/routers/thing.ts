import { z } from "zod";

import { protectedProcedure } from "../trpc/trpc.js";

export const create = protectedProcedure
  .input(z.object({ id: z.string() }).strict())
  .mutation(() => null);
