import { z } from "zod";

export const createThingResponseSchema = z.object({ id: z.string(), name: z.string() }).strict();

export type CreateThingResponse = z.infer<typeof createThingResponseSchema>;
