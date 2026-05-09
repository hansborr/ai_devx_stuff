import { z } from "zod";

export const updateThingInputSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .strict();

export type UpdateThingInput = z.infer<typeof updateThingInputSchema>;
