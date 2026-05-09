import { z } from "zod";

export const thingOutputSchema = z.object({ id: z.string() });

export const existingInputSchema = z.object({ page: z.number() }).strict();

export type ExistingInput = z.infer<typeof existingInputSchema>;

export const createInputSchema = z.object({ id: z.string() }).strict();

export type CreateInput = z.infer<typeof createInputSchema>;
