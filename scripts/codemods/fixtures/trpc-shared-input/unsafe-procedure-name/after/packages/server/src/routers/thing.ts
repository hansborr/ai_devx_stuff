import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  "get-by-id": protectedProcedure.input(z.object({ id: z.string() }).strict()).query(() => null),
});
