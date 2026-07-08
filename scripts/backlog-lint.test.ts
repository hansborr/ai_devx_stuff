import { describe, expect, it } from "vitest";

import { runBacklogLint } from "./backlog-lint.js";

describe("runBacklogLint", () => {
  it("accepts existing backlog header shapes and reports a clean advisory check", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/example.md",
          text: [
            "# Example",
            "",
            "Status: Parked",
            "Date: 2026-07-03",
            "Source: test",
            "",
            "## Context",
          ].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/arch-review-2026-07/19-shipped.md",
          text: [
            "# 19. Shipped",
            "",
            "Status: Done - implemented 2026-07-07 on branch `fix/example`",
            "Size: S",
            "",
            "## Problem",
          ].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/pack/00-index.md",
          text: [
            "# Pack",
            "",
            "Status: Parked task index",
            "Created: 2026-07-03",
            "",
            "## Scope",
          ].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.stdout).toContain("backlog:lint OK - 3 note(s) checked");
    expect(result.stdout).toContain("0 advisory finding(s)");
  });

  it("reports front-matter and staleness findings without making the command fail", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/missing-status.md",
          text: ["# Missing Status", "", "Date: 2026-07-01", "", "Body"].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/bad-date.md",
          text: ["# Bad Date", "", "Status: Parked", "Date: 2026-99-99", "", "Body"].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/stale.md",
          text: ["# Stale", "", "Status: Parked", "Date: 2025-12-01", "", "Body"].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
      requireFrontMatter: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "invalid-date",
      "missing-status",
      "stale-note",
    ]);
    expect(result.stdout).toContain("backlog:lint advisory findings");
    expect(result.stdout).toContain("missing-status.md");
    expect(result.stdout).toContain("bad-date.md");
    expect(result.stdout).toContain("stale.md");
  });

  it("uses dated pack paths as a fallback for legacy leaves without a date line", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/harness-review-2026-07/10-leaf.md",
          text: ["# 10. Leaf", "", "Status: Proposed", "", "## Problem"].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
    });

    expect(result.findings).toEqual([]);
  });
});
