import { describe, expect, it } from "vitest";

import { editCheckTargetsFileToRead } from "./modes.js";

describe("editCheckTargetsFileToRead", () => {
  it("skips silently when no --targets-file was passed", () => {
    const notices: string[] = [];
    const result = editCheckTargetsFileToRead(
      undefined,
      () => false,
      (message) => notices.push(message),
    );
    expect(result).toBeUndefined();
    expect(notices).toEqual([]);
  });

  it("emits a breadcrumb when the flag named a file that does not exist", () => {
    const notices: string[] = [];
    const result = editCheckTargetsFileToRead(
      "/tmp/targets.txt",
      () => false,
      (message) => notices.push(message),
    );
    expect(result).toBeUndefined();
    expect(notices).toEqual([
      "lint:ratchet: --edit-check targets file not found: /tmp/targets.txt; skipping",
    ]);
  });

  it("returns the path to read when the file exists", () => {
    const notices: string[] = [];
    const result = editCheckTargetsFileToRead(
      "/tmp/targets.txt",
      () => true,
      (message) => notices.push(message),
    );
    expect(result).toBe("/tmp/targets.txt");
    expect(notices).toEqual([]);
  });
});
