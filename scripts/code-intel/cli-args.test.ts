import { describe, expect, it } from "vitest";

import { parseArgs } from "./cli-args.js";

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected function to throw");
}

describe("parseArgs", () => {
  it("keeps code:intel empty string argv entries strict", () => {
    expect(thrownMessage(() => parseArgs([""]))).toBe(
      "code:intel: Empty arguments are not supported.",
    );
  });
});
