import { z } from "zod";

import { idField, MAX_NAME_LENGTH } from "../constants.js";

export const getInputSchema = z.object({ id: idField, name: z.string().max(MAX_NAME_LENGTH) }).strict();

export type GetInput = z.infer<typeof getInputSchema>;
