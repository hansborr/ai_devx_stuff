import { z } from "zod";

export const existingInputSchema = z.object({ page: z.number() }).strict();
export type ExistingInput = z.infer<typeof existingInputSchema>;
