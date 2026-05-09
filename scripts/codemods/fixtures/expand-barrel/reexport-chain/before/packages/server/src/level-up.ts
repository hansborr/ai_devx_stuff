import { checkMulticlassPrerequisites, hitDieAverage } from "@musi/shared/rules";

export const prerequisites = checkMulticlassPrerequisites();
export const hp = hitDieAverage(6);
