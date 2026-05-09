import { z } from "zod";

export const createInputSchema = z.object({ id: z.string() }).strict();
