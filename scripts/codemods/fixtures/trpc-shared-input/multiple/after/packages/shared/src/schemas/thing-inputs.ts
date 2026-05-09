import { z } from "zod";

export const createInputSchema = z.object({ name: z.string() }).strict();

export type CreateInput = z.infer<typeof createInputSchema>;

export const updateThingInputSchema = z.object({ id: z.string(), name: z.string() }).strict();

export type UpdateThingInput = z.infer<typeof updateThingInputSchema>;
