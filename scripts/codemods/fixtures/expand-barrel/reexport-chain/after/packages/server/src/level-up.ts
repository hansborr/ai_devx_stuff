import { hitDieAverage } from "@musi/shared/rules/character-rules.js";
import { checkMulticlassPrerequisites } from "@musi/shared/rules/multiclass-rules.js";

export const prerequisites = checkMulticlassPrerequisites();
export const hp = hitDieAverage(6);
