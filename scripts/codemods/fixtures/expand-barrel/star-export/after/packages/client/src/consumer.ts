import { add, type NumberBox } from "@musi/shared/rules/math.js";

export function sum(box: NumberBox): number {
  return add(box.value, 1);
}
