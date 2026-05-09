import { otherSummarySchema } from "@musi/shared/schemas/common/other.js";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  list: protectedProcedure.output(z.array(otherSummarySchema)).query(() => []),
});
