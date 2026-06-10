import { describe, expect, it } from "vitest";

import {
  buildCommitIntentOverlay,
  classifyCommitIntent,
  formatCommitIntentOverlay,
} from "./commit-intent.js";

describe("classifyCommitIntent", () => {
  it("classifies subjects case-insensitively across the seeded intent categories", () => {
    expect(classifyCommitIntent("FIX: patch login").category).toBe("fix");
    expect(classifyCommitIntent("Refactor parser helpers").category).toBe("refactor");
    expect(classifyCommitIntent("feat: scaffold encounter drawer").category).toBe("scaffold");
    expect(classifyCommitIntent("chore: regenerate prisma client").category).toBe("generated");
    expect(classifyCommitIntent("deps: bump vite").category).toBe("update");
  });

  it("uses deterministic precedence when a subject matches multiple categories", () => {
    expect(classifyCommitIntent("fix: regenerate stale client").category).toBe("generated");
    expect(classifyCommitIntent("refactor: update parser shape").category).toBe("refactor");
  });

  it("falls back to unknown and preserves the subject evidence", () => {
    expect(classifyCommitIntent("polish the nearby flow")).toEqual({
      category: "unknown",
      subject: "polish the nearby flow",
      trailerHints: [],
    });
    expect(classifyCommitIntent("feat: create campaign flow").category).toBe("unknown");
  });

  it("accepts optional trailer hints without requiring the git collector to scan trailers", () => {
    expect(
      classifyCommitIntent({
        subject: "chore: refresh assets",
        trailers: ["Generated-by: sprite-pipeline", "Reviewed-by: Ada"],
      }),
    ).toEqual({
      category: "generated",
      subject: "chore: refresh assets",
      trailerHints: ["Generated-by: sprite-pipeline"],
    });
  });
});

describe("buildCommitIntentOverlay", () => {
  it("groups recent subjects by label while preserving subject evidence order", () => {
    expect(
      buildCommitIntentOverlay([
        "fix: close race",
        "refactor: extract turn service",
        "fix: repair retry path",
      ]),
    ).toEqual([
      {
        category: "fix",
        subjects: ["fix: close race", "fix: repair retry path"],
        trailerHints: [],
      },
      {
        category: "refactor",
        subjects: ["refactor: extract turn service"],
        trailerHints: [],
      },
    ]);
  });

  it("renders compact advisory text with the subjects that drove each label", () => {
    const overlay = buildCommitIntentOverlay(["fix: close race", "write down context"]);

    expect(formatCommitIntentOverlay(overlay)).toBe(
      'fix ("fix: close race"), unknown ("write down context")',
    );
  });
});
