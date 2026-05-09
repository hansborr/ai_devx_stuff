import { z } from "zod";

import { idField } from "../constants.js";

type idField = string;

export const getInputSchema = z.object({ id: idField }).strict();

export type GetInput = z.infer<typeof getInputSchema>;
