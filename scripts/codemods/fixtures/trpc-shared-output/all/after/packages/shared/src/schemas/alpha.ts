import { z } from "zod";

export const getOutputSchema = z.object({ id: z.string() });

export type GetOutput = z.infer<typeof getOutputSchema>;
