import { describe, expect, it } from "vitest";

import { parsePrePushTriggerExtensions, prePushScopePinFailures } from "./pre-push-scope-pin.js";

const TRIGGER_LINE = String.raw`      if grep -qE '(^|/)(sensor-near-duplicates\.baseline|drift-ai\.config)\.json$|\.(ts|tsx|js|jsx|mjs|cjs)$' <<< "$changed"; then`;

const HOOK_TEXT = [
  "#!/bin/sh",
  "musi_pre_push_near_duplicates_boundary() {",
  TRIGGER_LINE,
  "}",
].join("\n");

const SCANNER_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

describe("pre-push source-extension pin", () => {
  it("parses the trigger alternation out of the near-duplicates boundary line", () => {
    expect(parsePrePushTriggerExtensions(HOOK_TEXT)).toEqual([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
    ]);
  });

  it("passes when the hook alternation matches the scanner extension set", () => {
    expect(prePushScopePinFailures(HOOK_TEXT, SCANNER_EXTENSIONS)).toEqual([]);
  });

  it("is order-insensitive: only set membership is pinned", () => {
    const reordered = HOOK_TEXT.replace("ts|tsx|js|jsx|mjs|cjs", "cjs|mjs|jsx|js|tsx|ts");
    expect(prePushScopePinFailures(reordered, SCANNER_EXTENSIONS)).toEqual([]);
  });

  it("fails when the scanner gains an extension the hook trigger lacks", () => {
    const failures = prePushScopePinFailures(HOOK_TEXT, new Set([...SCANNER_EXTENSIONS, ".mts"]));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(".mts");
    expect(failures[0]).toContain("ts|tsx|js|jsx|mjs|cjs|mts");
  });

  it("fails when the hook trigger lists an extension the scanner no longer scans", () => {
    const narrowed = new Set([".ts", ".tsx"]);
    const failures = prePushScopePinFailures(HOOK_TEXT, narrowed);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(".js");
  });

  it("accepts hyphenated extensions the scanner config can add (e.g. .foo-bar)", () => {
    const widened = HOOK_TEXT.replace("ts|tsx|js|jsx|mjs|cjs", "ts|tsx|js|jsx|mjs|cjs|foo-bar");
    expect(parsePrePushTriggerExtensions(widened)).toContain(".foo-bar");
    expect(prePushScopePinFailures(widened, new Set([...SCANNER_EXTENSIONS, ".foo-bar"]))).toEqual(
      [],
    );
  });

  it("accepts regex-significant extensions when the hook alternation escapes them", () => {
    const widened = HOOK_TEXT.replace(
      "ts|tsx|js|jsx|mjs|cjs",
      String.raw`ts|tsx|js|jsx|mjs|cjs|c\+\+`,
    );
    expect(parsePrePushTriggerExtensions(widened)).toContain(".c++");
    expect(prePushScopePinFailures(widened, new Set([...SCANNER_EXTENSIONS, ".c++"]))).toEqual([]);
  });

  it("regex-escapes regex-significant extensions in the suggested replacement", () => {
    const failures = prePushScopePinFailures(HOOK_TEXT, new Set([...SCANNER_EXTENSIONS, ".c++"]));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("missing from the hook trigger: .c++");
    expect(failures[0]).toContain(String.raw`ts|tsx|js|jsx|mjs|cjs|c\+\+`);
  });

  it("fails loudly when the trigger line cannot be found at all", () => {
    const failures = prePushScopePinFailures("#!/bin/sh\necho hi\n", SCANNER_EXTENSIONS);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("near-duplicates boundary trigger");
  });

  it("fails loudly when the anchor matches but the alternation shape changed", () => {
    const mangled = HOOK_TEXT.replace(String.raw`|\.(ts|tsx|js|jsx|mjs|cjs)$`, "");
    const failures = prePushScopePinFailures(mangled, SCANNER_EXTENSIONS);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("near-duplicates boundary trigger");
  });
});
