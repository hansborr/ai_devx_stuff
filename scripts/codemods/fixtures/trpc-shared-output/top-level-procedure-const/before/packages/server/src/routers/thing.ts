import { thingSummarySchema } from "@musi/shared/schemas/thing.js";
import { z } from "zod";

import { protectedProcedure } from "../trpc/trpc.js";

export const list = protectedProcedure.output(z.array(thingSummarySchema)).query(() => []);
