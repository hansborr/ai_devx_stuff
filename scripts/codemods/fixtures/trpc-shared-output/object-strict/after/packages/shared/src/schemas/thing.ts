import { z } from "zod";

export const createOutputSchema = z.object({ success: z.boolean() }).strict();

export type CreateOutput = z.infer<typeof createOutputSchema>;
