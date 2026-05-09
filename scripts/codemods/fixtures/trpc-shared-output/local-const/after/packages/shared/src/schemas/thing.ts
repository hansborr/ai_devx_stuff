import { z } from "zod";

export const updateThingResultSchema = z.object({ id: z.string(), name: z.string() });

export type UpdateThingResult = z.infer<typeof updateThingResultSchema>;
