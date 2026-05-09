import { z } from "zod";

import { idField } from "../constants.js";

export const getOutputSchema = z.object({ id: idField });

export type GetOutput = z.infer<typeof getOutputSchema>;
