import { z } from "zod";

export const existingInputSchema = z.object({ page: z.number() }).strict();
