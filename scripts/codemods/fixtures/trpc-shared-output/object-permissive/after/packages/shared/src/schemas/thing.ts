import { z } from "zod";

export const removeOutputSchema = z.object({ success: z.boolean() });

export type RemoveOutput = z.infer<typeof removeOutputSchema>;
