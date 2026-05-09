import { z } from "zod";

import { otherSummarySchema } from "../common/other.js";

export const listOutputSchema = z.array(otherSummarySchema);

export type ListOutput = z.infer<typeof listOutputSchema>;
