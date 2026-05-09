import { idField } from "@musi/shared/constants";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.output(z.object({ id: idField })).query(() => null),
});
