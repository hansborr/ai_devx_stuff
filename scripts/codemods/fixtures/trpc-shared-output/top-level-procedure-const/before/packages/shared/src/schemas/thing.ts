import { z } from "zod";

export const thingSummarySchema = z.object({ id: z.string() });
