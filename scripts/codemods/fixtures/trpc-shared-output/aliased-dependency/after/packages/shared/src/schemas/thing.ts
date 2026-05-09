import { z } from "zod";

import { otherSummarySchema as summarySchema } from "./other.js";

export const listOutputSchema = z.array(summarySchema);

export type ListOutput = z.infer<typeof listOutputSchema>;
