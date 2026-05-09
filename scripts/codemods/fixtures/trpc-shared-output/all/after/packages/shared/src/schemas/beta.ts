import { z } from "zod";

export const listOutputSchema = z.object({ ids: z.array(z.string()) });

export type ListOutput = z.infer<typeof listOutputSchema>;
