import { z } from "zod";

import { idField } from "../utils/id-field.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.input(z.object({ id: idField }).strict()).query(() => null),
});
