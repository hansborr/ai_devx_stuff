import { describe, expect, it } from "vitest";

import { scanStaleMarkers, STALE_MARKER_KINDS } from "./coldspots-markers.js";

describe("scanStaleMarkers", () => {
  it("finds TODO/FIXME/HACK/XXX inside line and block comments", () => {
    const source = [
      "const x = 1; // TODO: wire this up",
      "/* FIXME handle the edge case */",
      "function f() {",
      "  // HACK temporary shim",
      "  return 0; // XXX revisit",
      "}",
    ].join("\n");

    const markers = scanStaleMarkers(source);

    expect(markers.map((m) => m.kind)).toEqual(["TODO", "FIXME", "HACK", "XXX"]);
    expect(markers.map((m) => m.lineNumber)).toEqual([1, 2, 4, 5]);
    expect(markers[0]?.text).toContain("TODO: wire this up");
  });

  it("finds @deprecated as a JSDoc tag inside a block comment", () => {
    const source = ["/**", " * @deprecated use bar() instead", " */", "function foo() {}"].join(
      "\n",
    );

    const markers = scanStaleMarkers(source);

    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe("@deprecated");
    expect(markers[0]?.lineNumber).toBe(2);
  });

  it("does NOT match a marker inside a string literal (comment-region restriction)", () => {
    const source = [
      'const label = "TODO: this is data, not a comment";',
      "const tpl = `FIXME inside a template literal`;",
      "const ok = 1; // TODO real one",
    ].join("\n");

    const markers = scanStaleMarkers(source);

    // Only the real comment marker on line 3 is surfaced.
    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe("TODO");
    expect(markers[0]?.lineNumber).toBe(3);
  });

  it("matches markers case-insensitively but normalizes the kind", () => {
    const source = ["// todo lowercase", "// Fixme mixed"].join("\n");

    const markers = scanStaleMarkers(source);

    expect(markers.map((m) => m.kind)).toEqual(["TODO", "FIXME"]);
  });

  it("requires a word boundary so TODOLIST or FIXMENOW does not match", () => {
    const source = ["// TODOLIST is not a marker", "// see FIXMENOW.md"].join("\n");

    const markers = scanStaleMarkers(source);

    expect(markers).toEqual([]);
  });

  it("counts multiple markers on the same comment line once per marker keyword", () => {
    const source = ["// TODO and also FIXME here"].join("\n");

    const markers = scanStaleMarkers(source);

    expect(markers.map((m) => m.kind)).toEqual(["TODO", "FIXME"]);
    expect(markers.every((m) => m.lineNumber === 1)).toBe(true);
  });

  it("exposes the recognized marker kinds", () => {
    expect(STALE_MARKER_KINDS).toContain("TODO");
    expect(STALE_MARKER_KINDS).toContain("@deprecated");
  });
});
