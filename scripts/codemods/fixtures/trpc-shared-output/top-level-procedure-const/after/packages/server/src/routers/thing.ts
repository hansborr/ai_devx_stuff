import { listOutputSchema } from "@musi/shared/schemas/thing.js";

import { protectedProcedure } from "../trpc/trpc.js";

export const list = protectedProcedure.output(listOutputSchema).query(() => []);
