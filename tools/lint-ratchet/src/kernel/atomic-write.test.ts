import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { writeFileAtomicallySync } from "./atomic-write.js";

describe("writeFileAtomicallySync", () => {
  it("replaces the destination and removes its same-directory temporary file", () => {
    const directory = mkdtempSync(join(tmpdir(), "musi-atomic-write-"));
    const path = join(directory, "baseline.json");
    try {
      writeFileSync(path, "old");
      writeFileAtomicallySync(path, "new");
      expect(readFileSync(path, "utf8")).toBe("new");
      expect(readdirSync(directory)).toEqual(["baseline.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cleans up the temporary path when rename fails", () => {
    const rmSync = vi.fn(() => undefined);

    expect(() => {
      writeFileAtomicallySync(
        "/repo/config.mjs",
        "export default [];\n",
        {},
        {
          writeFileSync: vi.fn(),
          renameSync: vi.fn(() => {
            throw new Error("rename failed");
          }),
          rmSync,
        },
      );
    }).toThrow("rename failed");
    expect(rmSync).toHaveBeenCalledOnce();
  });
});
