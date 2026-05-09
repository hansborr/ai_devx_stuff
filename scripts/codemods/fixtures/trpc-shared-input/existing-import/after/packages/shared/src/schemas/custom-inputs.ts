import { z } from "zod";

export const existingInputSchema = z.object({ page: z.number() }).strict();

export const createInputSchema = z.object({ id: z.string() }).strict();

export type CreateInput = z.infer<typeof createInputSchema>;
