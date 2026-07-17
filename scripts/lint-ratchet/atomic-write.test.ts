import { describe, expect, it, vi } from "vitest";

import { writeFileAtomicallySync } from "./atomic-write.js";

describe("writeFileAtomicallySync", () => {
  it("writes a same-directory temporary file before renaming it", () => {
    const calls: string[] = [];
    const deps = {
      writeFileSync: vi.fn((path: string) => calls.push(`write:${path}`)),
      renameSync: vi.fn((from: string, to: string) => calls.push(`rename:${from}->${to}`)),
      rmSync: vi.fn((path: string) => calls.push(`rm:${path}`)),
    };

    writeFileAtomicallySync("/repo/lint-ratchet.baseline.json", "{}\n", deps);

    expect(calls[0]).toMatch(/^write:\/repo\/\.lint-ratchet\.baseline\.json\./u);
    expect(calls[1]).toMatch(
      /^rename:\/repo\/\.lint-ratchet\.baseline\.json\..*->\/repo\/lint-ratchet\.baseline\.json$/u,
    );
    expect(calls[2]).toMatch(/^rm:\/repo\/\.lint-ratchet\.baseline\.json\./u);
  });

  it("cleans up the temporary path when rename fails", () => {
    const rmSync = vi.fn(() => undefined);

    expect(() => {
      writeFileAtomicallySync("/repo/config.mjs", "export default [];\n", {
        writeFileSync: vi.fn(),
        renameSync: vi.fn(() => {
          throw new Error("rename failed");
        }),
        rmSync,
      });
    }).toThrow("rename failed");
    expect(rmSync).toHaveBeenCalledOnce();
  });
});
