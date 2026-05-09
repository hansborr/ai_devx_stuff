import { z } from "zod";

export const thingSummarySchema = z.object({ id: z.string() });

export const listOutputSchema = z.array(thingSummarySchema);

export type ListOutput = z.infer<typeof listOutputSchema>;
