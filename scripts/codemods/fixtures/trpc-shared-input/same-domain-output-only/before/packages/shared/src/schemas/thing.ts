import { z } from "zod";

export const thingOutputSchema = z.object({ id: z.string() });
