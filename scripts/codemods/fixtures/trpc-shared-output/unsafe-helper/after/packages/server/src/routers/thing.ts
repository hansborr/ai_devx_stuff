import { z } from "zod";

import { resultField } from "../utils/result-field.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  get: protectedProcedure.output(z.object({ result: resultField })).query(() => null),
});
