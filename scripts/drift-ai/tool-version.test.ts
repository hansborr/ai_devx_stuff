import { describe, expect, it } from "vitest";

import { parseToolVersionOutput } from "./tool-version.js";

describe("parseToolVersionOutput", () => {
  it("extracts the labeled semantic version among companion runtime lines", () => {
    expect(
      parseToolVersionOutput("Dolos 2.9.3\nNode.js v20.12.2\nTree-sitter 0.22.6\n", "dolos"),
    ).toBe("2.9.3");
  });

  it("parses a bare version line printed on its own", () => {
    expect(parseToolVersionOutput("1.165.0\n", "semgrep")).toBe("1.165.0");
  });

  it("parses a labeled line for the named tool while skipping noise", () => {
    expect(parseToolVersionOutput("warning: metrics\nsemgrep 1.165.0\n", "semgrep")).toBe(
      "1.165.0",
    );
  });

  it("returns undefined when the banner is not recognizable", () => {
    expect(parseToolVersionOutput("unknown tool\n", "dolos")).toBeUndefined();
    expect(parseToolVersionOutput("command not found\n", "semgrep")).toBeUndefined();
  });
});
