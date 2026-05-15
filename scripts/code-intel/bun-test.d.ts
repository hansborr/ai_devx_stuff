declare module "bun:test" {
  import type { describe as vitestDescribe, expect as vitestExpect, it as vitestIt } from "vitest";

  export const describe: typeof vitestDescribe;
  export const expect: typeof vitestExpect;
  export const it: typeof vitestIt;
}
