import { describe, expect, it } from "vitest";

import { renderBaselineMergeAttributes } from "./baseline-info-attributes.js";

const MANAGED_BEGIN = "# BEGIN musi lint-ratchet baseline driver attributes";
const MANAGED_END = "# END musi lint-ratchet baseline driver attributes";
const MANAGED_ATTRIBUTES = [
  "/lint-ratchet.debt-log.jsonl merge=union",
  "/lint-ratchet.baseline.json merge=lint-ratchet-baseline",
].join("\n");

function render(currentAttributes: string | undefined): string {
  return renderBaselineMergeAttributes({
    currentAttributes,
    managedBegin: MANAGED_BEGIN,
    managedEnd: MANAGED_END,
    managedAttributes: MANAGED_ATTRIBUTES,
  });
}

describe("renderBaselineMergeAttributes", () => {
  it("writes just the managed block when there is no attributes file", () => {
    expect(render(undefined)).toBe(`${MANAGED_BEGIN}\n${MANAGED_ATTRIBUTES}\n${MANAGED_END}\n`);
  });

  it("appends the block after unrelated rows with a blank separator", () => {
    expect(render("unrelated/path merge=union\n")).toBe(
      `unrelated/path merge=union\n\n${MANAGED_BEGIN}\n${MANAGED_ATTRIBUTES}\n${MANAGED_END}\n`,
    );
  });

  it("drops this driver's stale loose rows before appending the fresh block", () => {
    const current = [
      "unrelated/path merge=union",
      "lint-ratchet.baseline.json -merge",
      "/lint-ratchet.baseline.json -merge",
      "",
    ].join("\n");
    // Both the anchored and un-anchored loose variants of a managed path are
    // dropped; only the unrelated row survives ahead of the managed block.
    expect(render(current)).toBe(
      `unrelated/path merge=union\n\n${MANAGED_BEGIN}\n${MANAGED_ATTRIBUTES}\n${MANAGED_END}\n`,
    );
  });

  it("refreshes an existing managed block in place rather than moving it", () => {
    const current = [
      "leading/row merge=union",
      MANAGED_BEGIN,
      "/lint-ratchet.baseline.json merge=stale",
      MANAGED_END,
      "trailing/row merge=union",
      "",
    ].join("\n");
    expect(render(current)).toBe(
      [
        "leading/row merge=union",
        MANAGED_BEGIN,
        "/lint-ratchet.debt-log.jsonl merge=union",
        "/lint-ratchet.baseline.json merge=lint-ratchet-baseline",
        MANAGED_END,
        "trailing/row merge=union",
        "",
      ].join("\n"),
    );
  });

  it("migrates a legacy shared block, preserving sibling rows as loose lines", () => {
    const current = [
      "unrelated/path merge=union",
      "# BEGIN musi baseline merge attributes",
      "/lint-ratchet.baseline.json merge=lint-ratchet-baseline",
      "/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline",
      "# END musi baseline merge attributes",
      "",
    ].join("\n");
    const rendered = render(current);
    // The legacy markers are gone; the sibling knip row survives as a loose line
    // so a standalone install does not revert it; this driver's block is fresh.
    expect(rendered).toContain(
      "/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline",
    );
    expect(rendered).not.toContain("# BEGIN musi baseline merge attributes");
    expect(rendered).toContain(MANAGED_BEGIN);
    expect(rendered).not.toContain(
      "unrelated/path merge=union\n# BEGIN musi baseline merge attributes",
    );
  });

  it("throws on an unterminated managed block instead of dropping trailing rules", () => {
    const current = [
      "unrelated/path merge=union",
      MANAGED_BEGIN,
      "/lint-ratchet.baseline.json merge=lint-ratchet-baseline",
    ].join("\n");
    expect(() => render(current)).toThrow();
  });

  it("normalizes CRLF managed markers without duplicating the block", () => {
    const current = [MANAGED_BEGIN, "/lint-ratchet.baseline.json merge=stale", MANAGED_END, ""]
      .join("\n")
      .replace(/\n/gu, "\r\n");
    const rendered = render(current);
    expect(rendered.match(/# BEGIN musi lint-ratchet baseline driver attributes/gu)).toHaveLength(
      1,
    );
  });
});
