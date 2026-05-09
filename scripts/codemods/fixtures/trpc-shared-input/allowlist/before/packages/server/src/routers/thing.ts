import { idField, MAX_NAME_LENGTH } from "@musi/shared/constants";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.input(z.object({ id: idField, name: z.string().max(MAX_NAME_LENGTH) }).strict()).query(() => null),
});
