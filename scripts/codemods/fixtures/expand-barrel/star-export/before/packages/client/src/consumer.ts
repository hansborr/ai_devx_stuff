import { add, type NumberBox } from "@musi/shared/rules";

export function sum(box: NumberBox): number {
  return add(box.value, 1);
}
