import { idField } from "@musi/shared/constants";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.input(z.object({ id: idField }).strict()).query(() => null),
});
