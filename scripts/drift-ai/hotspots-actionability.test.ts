import { describe, expect, it } from "vitest";

import {
  aggregateAuthors,
  buildPathRowActionability,
  buildRowActionability,
  pairKey,
  recentSubjects,
  shellQuoteArg,
  tagSectionsWithBaseline,
} from "./hotspots-actionability.js";
import type {
  ChurnSection,
  CouplingSection,
  FragmentationSection,
  HotspotSection,
  SuppressionChurnSection,
  ThrashSection,
} from "./hotspots-format.js";
import type { CommitRecord } from "./hotspots-history.js";

function rec(over: Partial<CommitRecord>): CommitRecord {
  return {
    hash: "h",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-05-29T00:00:00-07:00",
    committerDate: "2026-05-29T00:00:00-07:00",
    subject: "s",
    coAuthors: [],
    files: [],
    ...over,
  };
}

function file(path: string): CommitRecord["files"][number] {
  return { path, added: 1, deleted: 0, binary: false };
}

const always = (): boolean => true;

describe("buildRowActionability", () => {
  it("derives authors/recent/intent from the touched records and carries the given inspect command", () => {
    const records = [
      rec({ subject: "fix flaky test", authorName: "Ada", files: [file("a.ts")] }),
      rec({ subject: "noise", authorName: "Bo", files: [file("other.ts")] }),
    ];
    const context = buildRowActionability(records, {
      touches: (record) => record.files.some((file) => file.path === "a.ts"),
      inspectCommand: "git log --oneline -G'pat' -- a.ts",
    });
    expect(context.authors).toEqual([{ name: "Ada", commits: 1 }]);
    expect(context.recentSubjects).toEqual(["fix flaky test"]);
    expect(context.commitIntent.map((overlay) => overlay.category)).toEqual(["fix"]);
    expect(context.inspectCommand).toBe("git log --oneline -G'pat' -- a.ts");
    expect(context.baseline).toBeNull();
  });
});

describe("buildPathRowActionability", () => {
  it("matches any record touching the path and builds the plain git-log inspect command", () => {
    const records = [rec({ subject: "touch", authorName: "Ada", files: [file("src/x y.ts")] })];
    const context = buildPathRowActionability(records, "src/x y.ts");
    expect(context.authors).toEqual([{ name: "Ada", commits: 1 }]);
    expect(context.recentSubjects).toEqual(["touch"]);
    // shellQuoteArg single-quotes the space-bearing path so the command is copy-paste safe.
    expect(context.inspectCommand).toBe("git log --oneline -- 'src/x y.ts'");
    expect(context.baseline).toBeNull();
  });
});

describe("aggregateAuthors", () => {
  it("counts the committer and each co-author, most-active first, with email stripped", () => {
    const records = [
      rec({ authorName: "Ada", coAuthors: ["Claude <noreply@anthropic.com>"] }),
      rec({ authorName: "Ada" }),
      rec({ authorName: "Bob", coAuthors: ["Claude <noreply@anthropic.com>"] }),
    ];

    expect(aggregateAuthors(records, always)).toEqual([
      { name: "Ada", commits: 2 },
      { name: "Claude", commits: 2 },
      { name: "Bob", commits: 1 },
    ]);
  });

  it("honors the touches predicate and the limit", () => {
    const records = [
      rec({ authorName: "Ada", files: [{ path: "a", added: 1, deleted: 0, binary: false }] }),
      rec({ authorName: "Bob", files: [{ path: "b", added: 1, deleted: 0, binary: false }] }),
    ];
    const touchesA = (record: CommitRecord): boolean =>
      record.files.some((file) => file.path === "a");

    const authors = aggregateAuthors(records, touchesA, 1);

    expect(authors).toEqual([{ name: "Ada", commits: 1 }]);
  });
});

describe("recentSubjects", () => {
  it("returns the first matching subjects (newest-first) capped at the limit", () => {
    const records = [
      rec({ subject: "newest" }),
      rec({ subject: "middle" }),
      rec({ subject: "older" }),
      rec({ subject: "oldest" }),
    ];

    expect(recentSubjects(records, always, 3)).toEqual(["newest", "middle", "older"]);
  });
});

describe("shellQuoteArg", () => {
  it("leaves clean paths unquoted and single-quotes paths with spaces/metacharacters", () => {
    expect(shellQuoteArg("src/hot.ts")).toBe("src/hot.ts");
    expect(shellQuoteArg("packages/@scope/a.ts")).toBe("packages/@scope/a.ts");
    expect(shellQuoteArg("src/dir with space/f.ts")).toBe("'src/dir with space/f.ts'");
    expect(shellQuoteArg("a'b.ts")).toBe(`'a'\\''b.ts'`);
  });
});

describe("pairKey", () => {
  it("orders the pair deterministically regardless of argument order", () => {
    expect(pairKey("src/z.ts", "src/a.ts")).toBe(pairKey("src/a.ts", "src/z.ts"));
    expect(pairKey("src/z.ts", "src/a.ts")).toContain("src/a.ts");
    expect(pairKey("src/z.ts", "src/a.ts")).toContain("src/z.ts");
  });
});

function churnSection(entries: ChurnSection["entries"]): ChurnSection {
  return {
    lens: "churn",
    metric: "revisions",
    standoutFactor: 2,
    medianScore: 1,
    emptyReason: null,
    entries,
  };
}

function couplingSection(entries: CouplingSection["entries"]): CouplingSection {
  return {
    lens: "coupling",
    scoreModel: "symmetric",
    minSupport: 3,
    degreeCap: 5,
    sweepCap: 40,
    emptyReason: null,
    entries,
  };
}

function fragmentationSection(entries: FragmentationSection["entries"]): FragmentationSection {
  return {
    lens: "fragmentation",
    minHands: 3,
    emptyReason: null,
    entries,
  };
}

function suppressionChurnSection(
  entries: SuppressionChurnSection["entries"],
): SuppressionChurnSection {
  return {
    lens: "suppression-churn",
    pattern: "eslint-disable",
    minChanges: 2,
    emptyReason: null,
    entries,
  };
}

function thrashSection(entries: ThrashSection["entries"]): ThrashSection {
  return {
    lens: "thrash",
    minRevisions: 3,
    maxNetLinesPerRevision: 2,
    youngDays: 30,
    emptyReason: null,
    entries,
  };
}

describe("tagSectionsWithBaseline", () => {
  it("tags churn rows NEW / up / down / steady against a prior advisory", () => {
    const current: HotspotSection[] = [
      churnSection([
        churnEntry("src/new.ts", 10),
        churnEntry("src/up.ts", 8),
        churnEntry("src/down.ts", 4),
        churnEntry("src/same.ts", 5),
      ]),
    ];
    const prior = {
      sections: [
        {
          lens: "churn",
          metric: "revisions",
          entries: [
            { path: "src/up.ts", score: 3 },
            { path: "src/down.ts", score: 9 },
            { path: "src/same.ts", score: 5 },
          ],
        },
      ],
    };

    const { sections, note } = tagSectionsWithBaseline(current, prior);
    const byPath = new Map((sections[0] as ChurnSection).entries.map((e) => [e.path, e.baseline]));

    expect(note).toBeNull();

    expect(byPath.get("src/new.ts")).toEqual({ status: "new", scoreDelta: 0 });
    expect(byPath.get("src/up.ts")).toEqual({ status: "up", scoreDelta: 5 });
    expect(byPath.get("src/down.ts")).toEqual({ status: "down", scoreDelta: -5 });
    expect(byPath.get("src/same.ts")).toEqual({ status: "steady", scoreDelta: 0 });
  });

  it("matches coupling rows by the sorted pair key", () => {
    const current: HotspotSection[] = [
      couplingSection([couplingEntry("client/b.ts", "src/a.ts", 0.8)]),
    ];
    // Prior stored the same pair in the opposite order — must still match.
    const prior = {
      sections: [{ lens: "coupling", entries: [{ a: "src/a.ts", b: "client/b.ts", score: 0.5 }] }],
    };

    const { sections } = tagSectionsWithBaseline(current, prior);

    expect((sections[0] as CouplingSection).entries[0]?.baseline).toEqual({
      status: "up",
      scoreDelta: 0.3,
    });
  });

  it("tags new path-keyed lens rows by path", () => {
    const current: HotspotSection[] = [fragmentationSection([fragmentationEntry("src/hot.ts", 5)])];
    const prior = {
      sections: [{ lens: "fragmentation", entries: [{ path: "src/hot.ts", score: 3 }] }],
    };

    const { sections } = tagSectionsWithBaseline(current, prior);

    expect((sections[0] as FragmentationSection).entries[0]?.baseline).toEqual({
      status: "up",
      scoreDelta: 2,
    });
  });

  it("matches the baseline row for every lens, including reversed coupling pairs", () => {
    const current: HotspotSection[] = [
      churnSection([churnEntry("src/a.ts", 7)]),
      couplingSection([couplingEntry("client/b.ts", "src/a.ts", 0.9)]),
      fragmentationSection([fragmentationEntry("src/a.ts", 6)]),
      suppressionChurnSection([suppressionChurnEntry("src/a.ts", 5)]),
      thrashSection([thrashEntry("src/a.ts", 8)]),
    ];
    const prior = {
      sections: [
        { lens: "churn", metric: "revisions", entries: [{ path: "src/a.ts", score: 4 }] },
        // Same pair stored in the opposite order — the shared rowKey must still match.
        { lens: "coupling", entries: [{ a: "src/a.ts", b: "client/b.ts", score: 0.6 }] },
        { lens: "fragmentation", entries: [{ path: "src/a.ts", score: 6 }] },
        { lens: "suppression-churn", entries: [{ path: "src/a.ts", score: 2 }] },
        { lens: "thrash", entries: [{ path: "src/a.ts", score: 8 }] },
      ],
    };

    const { sections, note } = tagSectionsWithBaseline(current, prior);

    expect(note).toBeNull();
    expect((sections[0] as ChurnSection).entries[0]?.baseline).toEqual({
      status: "up",
      scoreDelta: 3,
    });
    expect((sections[1] as CouplingSection).entries[0]?.baseline).toEqual({
      status: "up",
      scoreDelta: 0.3,
    });
    expect((sections[2] as FragmentationSection).entries[0]?.baseline).toEqual({
      status: "steady",
      scoreDelta: 0,
    });
    expect((sections[3] as SuppressionChurnSection).entries[0]?.baseline).toEqual({
      status: "up",
      scoreDelta: 3,
    });
    expect((sections[4] as ThrashSection).entries[0]?.baseline).toEqual({
      status: "steady",
      scoreDelta: 0,
    });
  });

  it("omits churn deltas (and notes it) when the baseline measured a different metric", () => {
    const current: HotspotSection[] = [churnSection([churnEntry("src/a.ts", 50)])];
    // churnSection() reports metric "revisions"; the baseline measured "lines".
    const prior = {
      sections: [{ lens: "churn", metric: "lines", entries: [{ path: "src/a.ts", score: 3000 }] }],
    };

    const { sections, note } = tagSectionsWithBaseline(current, prior);

    expect((sections[0] as ChurnSection).entries[0]?.baseline).toBeNull();
    expect(note).toContain("baseline churn metric 'lines' differs from current 'revisions'");
  });

  it("treats a malformed/empty baseline (incl. non-finite scores) as all-NEW without throwing", () => {
    const current: HotspotSection[] = [churnSection([churnEntry("src/a.ts", 4)])];

    const bads: unknown[] = [
      null,
      42,
      {},
      { sections: "nope" },
      { sections: [{}] },
      // Infinity/NaN scores pass typeof but must be rejected by the finite guard.
      { sections: [{ lens: "churn", entries: [{ path: "src/a.ts", score: Infinity }] }] },
    ];
    for (const bad of bads) {
      const { sections } = tagSectionsWithBaseline(current, bad);
      expect((sections[0] as ChurnSection).entries[0]?.baseline).toEqual({
        status: "new",
        scoreDelta: 0,
      });
    }
  });
});

function churnEntry(path: string, score: number): ChurnSection["entries"][number] {
  return {
    path,
    revisions: score,
    linesChanged: score,
    score,
    authors: [],
    recentSubjects: [],
    commitIntent: [],
    inspectCommand: `git log --oneline -- ${path}`,
    baseline: null,
  };
}

function couplingEntry(a: string, b: string, score: number): CouplingSection["entries"][number] {
  return {
    a,
    b,
    coChanges: 4,
    revisionsA: 5,
    revisionsB: 5,
    score,
    crossBoundary: true,
    authors: [],
    recentSubjects: [],
    commitIntent: [],
    inspectCommand: `git log --oneline -- ${a} ${b}`,
    baseline: null,
  };
}

function fragmentationEntry(path: string, score: number): FragmentationSection["entries"][number] {
  return {
    path,
    distinctHands: score,
    authorHands: score,
    trailerHands: 0,
    sampleHands: [],
    revisions: score,
    score,
    authors: [],
    recentSubjects: [],
    commitIntent: [],
    inspectCommand: `git log --oneline -- ${path}`,
    baseline: null,
  };
}

function suppressionChurnEntry(
  path: string,
  score: number,
): SuppressionChurnSection["entries"][number] {
  return {
    path,
    suppressionChanges: score,
    score,
    authors: [],
    recentSubjects: [],
    commitIntent: [],
    inspectCommand: `git log --oneline -- ${path}`,
    baseline: null,
  };
}

function thrashEntry(path: string, score: number): ThrashSection["entries"][number] {
  return {
    path,
    revisions: score,
    linesChanged: score,
    netLines: 0,
    netLinesPerRevision: 0,
    fixRevertCommits: 0,
    firstTouchAgeDays: null,
    youngInWindow: false,
    testChurnRatio: 0,
    score,
    authors: [],
    recentSubjects: [],
    commitIntent: [],
    inspectCommand: `git log --oneline -- ${path}`,
    baseline: null,
  };
}
