import { describe, expect, it, vi } from "vitest";

import { type MergeDriverCliConfig, runMergeDriverCli } from "./merge-cli.js";

function config(merge: MergeDriverCliConfig["merge"]): MergeDriverCliConfig {
  return {
    usage: "usage: fixture <base> <current> <other>",
    unresolvedFailureLabel: "fixture semantic merge could not resolve",
    fatalFailureLabel: "fixture semantic merge failed",
    markerMessage: "fixture requires truth-up",
    merge,
  };
}

describe("runMergeDriverCli", () => {
  it("validates positional arguments with the configured usage text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const readText = vi.fn(() => Promise.resolve("unused"));

    await expect(
      runMergeDriverCli(
        [],
        config(() => ({ failures: [], postMergeTruthUpRequired: false })),
        {
          readText,
        },
      ),
    ).resolves.toBe(2);

    expect(error).toHaveBeenCalledWith("usage: fixture <base> <current> <other>");
    expect(readText).not.toHaveBeenCalled();
  });

  it("passes all three files to the callback and writes marker before baseline", async () => {
    const events: string[] = [];
    const merge = vi.fn(() => ({
      mergedText: "merged",
      failures: [],
      postMergeTruthUpRequired: true,
    }));

    await expect(
      runMergeDriverCli(["base", "current", "other", "display", "marker", "head"], config(merge), {
        readText: (path) => Promise.resolve(`${path}-text`),
        writeMarker: (...args) => {
          events.push(`marker:${args.join(":")}`);
          return Promise.resolve();
        },
        writeBaseline: (path, text) => {
          events.push(`baseline:${path}:${text}`);
          return Promise.resolve();
        },
      }),
    ).resolves.toBe(0);

    expect(merge).toHaveBeenCalledWith({
      baseText: "base-text",
      currentText: "current-text",
      otherText: "other-text",
    });
    expect(events).toEqual([
      "marker:marker:head:true:fixture requires truth-up",
      "baseline:current:merged",
    ]);
  });

  it("prints configured failures without writing the current file", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const writeMarker = vi.fn(() => Promise.resolve());
    const writeBaseline = vi.fn(() => Promise.resolve());

    await expect(
      runMergeDriverCli(
        ["base", "current", "other", "display.json"],
        config(() => ({
          failures: ["left and right disagree"],
          postMergeTruthUpRequired: false,
        })),
        { readText: () => Promise.resolve("text"), writeMarker, writeBaseline },
      ),
    ).resolves.toBe(1);

    expect(error).toHaveBeenNthCalledWith(
      1,
      "fixture semantic merge could not resolve display.json:",
    );
    expect(error).toHaveBeenNthCalledWith(2, "  - left and right disagree");
    expect(writeMarker).not.toHaveBeenCalled();
    expect(writeBaseline).not.toHaveBeenCalled();
  });
});
