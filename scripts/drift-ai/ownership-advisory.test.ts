import { describe, expect, it } from "vitest";

import type { BoundedFullHistory } from "./bounded-full-history.js";
import { FULL_HISTORY_RENAME_CAVEAT } from "./bounded-full-history-disclosure.js";
import type { CommitRecord } from "./hotspots-history.js";
import {
  buildOwnershipAdvisory,
  DEFAULT_OWNERSHIP_TOP,
  formatOwnershipAdvisoryJson,
  formatOwnershipAdvisoryText,
} from "./ownership-advisory.js";
import type { PrototypeCap } from "./prototype-advisory.js";

function rec(overrides: Partial<CommitRecord>): CommitRecord {
  return {
    hash: "h",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-05-29T00:00:00Z",
    committerDate: "2026-05-29T00:00:00Z",
    subject: "subject",
    coAuthors: [],
    files: [],
    ...overrides,
  };
}

function change(path: string, added = 1, deleted = 0): CommitRecord["files"][number] {
  return { path, added, deleted, binary: false };
}

function history(
  records: readonly CommitRecord[],
  overrides: Partial<BoundedFullHistory> = {},
): BoundedFullHistory {
  const prototypeCaps: PrototypeCap[] = [
    { label: "full-history commits", limit: 5000, hit: false, detail: null },
  ];
  return {
    records,
    commitCount: records.length,
    distinctFileCount: new Set(records.flatMap((record) => record.files.map((file) => file.path)))
      .size,
    requestedCaps: {
      since: null,
      maxCommits: 5000,
      maxFiles: 20000,
      maxOutputBytes: 512,
      timeoutMs: 30000,
    },
    scannedRange: {
      since: null,
      newestCommitHash: records[0]?.hash ?? null,
      newestCommitDate: records[0]?.authorDate ?? null,
      oldestCommitHash: records.at(-1)?.hash ?? null,
      oldestCommitDate: records.at(-1)?.authorDate ?? null,
    },
    partial: false,
    stoppedReason: "completed",
    moreCommitsObserved: false,
    moreHistoryMayExist: false,
    unexamined: {
      commits: { kind: "known", count: 0 },
      files: { kind: "known", count: 0 },
    },
    linesAvailable: true,
    elapsedMs: 12,
    renameCaveat: FULL_HISTORY_RENAME_CAVEAT,
    degradations: [],
    prototypeCaps,
    gitError: null,
    ...overrides,
  };
}

describe("buildOwnershipAdvisory", () => {
  it("computes first author, dominant owner, own-vs-other changes, recency, and inspect evidence", () => {
    const advisory = buildOwnershipAdvisory({
      history: history([
        rec({
          hash: "newest",
          authorName: "Bob",
          authorEmail: "bob@example.com",
          authorDate: "2026-05-29T00:00:00Z",
          subject: "fix: recent unrelated",
          files: [change("src/elsewhere.ts", 3, 1)],
        }),
        rec({
          hash: "owner-recent",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          authorDate: "2026-05-20T00:00:00Z",
          subject: "refactor: adjust owned flow",
          files: [change("src/owned.ts", 2, 2)],
        }),
        rec({
          hash: "other-touch",
          authorName: "Bob",
          authorEmail: "bob@example.com",
          authorDate: "2026-05-10T00:00:00Z",
          subject: "fix: touch owned flow",
          files: [change("src/owned.ts", 1, 1)],
        }),
        rec({
          hash: "birth",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          authorDate: "2026-01-01T00:00:00Z",
          subject: "feat: create owned flow",
          files: [change("src/owned.ts", 10, 0)],
        }),
      ]),
      top: 10,
    });

    const row = advisory.sections[0]?.entries.find((entry) => entry.path === "src/owned.ts");

    expect(row).toMatchObject({
      path: "src/owned.ts",
      firstAuthor: { name: "Ada", email: "ada@example.com" },
      dominantOwner: { name: "Ada", email: "ada@example.com" },
      author: {
        name: "Ada",
        email: "ada@example.com",
        changes: 2,
        authoredChanges: 2,
        lastTouchDate: "2026-05-20T00:00:00Z",
      },
      ownershipChanges: { own: 2, other: 1, total: 3 },
      authoredChanges: { own: 2, other: 1, total: 3 },
      ownerTouchRecencyDays: 9,
      ownerRepoRecencyDays: 9,
      recentSubjects: [
        "refactor: adjust owned flow",
        "fix: touch owned flow",
        "feat: create owned flow",
      ],
      commitIntent: [
        {
          category: "refactor",
          subjects: ["refactor: adjust owned flow"],
          trailerHints: [],
        },
        { category: "fix", subjects: ["fix: touch owned flow"], trailerHints: [] },
        { category: "unknown", subjects: ["feat: create owned flow"], trailerHints: [] },
      ],
      inspectCommand: "git log --oneline -- src/owned.ts",
    });
    expect(row?.ownershipScore).toBeCloseTo(0.67, 2);
    expect(row?.lineShare).toBeCloseTo(0.88, 2);
  });

  it("counts co-authors as contributing hands while keeping author, coAuthors, and agentHands distinct", () => {
    const advisory = buildOwnershipAdvisory({
      history: history([
        rec({
          hash: "c3",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          coAuthors: ["Review Bot <bot@example.com>"],
          subject: "feat: third",
          files: [change("src/paired.ts", 5, 0)],
        }),
        rec({
          hash: "c2",
          authorName: "Bob",
          authorEmail: "bob@example.com",
          coAuthors: ["Review Bot <bot@example.com>"],
          subject: "feat: second",
          files: [change("src/paired.ts", 5, 0)],
        }),
        rec({
          hash: "c1",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          coAuthors: ["Review Bot <bot@example.com>"],
          subject: "feat: first",
          files: [change("src/paired.ts", 5, 0)],
        }),
      ]),
      agentIdentityPatterns: ["bot@example\\.com"],
      top: 10,
    });

    const row = advisory.sections[0]?.entries[0];

    expect(row).toMatchObject({
      dominantOwner: { name: "Review Bot", email: "bot@example.com", changes: 3 },
      author: { name: "Ada", email: "ada@example.com", changes: 2, authoredChanges: 2 },
      ownershipChanges: { own: 3, other: 3, total: 6 },
      authoredChanges: { own: 0, other: 3, total: 3 },
      coAuthors: [
        {
          name: "Review Bot",
          email: "bot@example.com",
          changes: 3,
          coAuthoredChanges: 3,
          lastTouchDate: "2026-05-29T00:00:00Z",
        },
      ],
      agentHands: [
        {
          name: "Review Bot",
          email: "bot@example.com",
          changes: 3,
          coAuthoredChanges: 3,
          lastTouchDate: "2026-05-29T00:00:00Z",
        },
      ],
    });
    expect(advisory.agentIdentityPatterns).toEqual(["bot@example\\.com"]);
  });

  it("coalesces author identities through a supplied mailmap resolver", () => {
    const advisory = buildOwnershipAdvisory({
      history: history([
        rec({
          hash: "new",
          authorName: "Ada Lovelace",
          authorEmail: "ada@new.example",
          authorDate: "2026-05-01T00:00:00Z",
          files: [change("src/mailmapped.ts", 2, 0)],
        }),
        rec({
          hash: "old",
          authorName: "Ada",
          authorEmail: "ada@old.example",
          authorDate: "2026-01-01T00:00:00Z",
          files: [change("src/mailmapped.ts", 2, 0)],
        }),
      ]),
      mailmapIdentity: (identity) =>
        identity.email === "ada@old.example"
          ? { name: "Ada Lovelace", email: "ada@new.example" }
          : identity,
    });

    const row = advisory.sections[0]?.entries[0];

    expect(row?.dominantOwner).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@new.example",
      changes: 2,
    });
    expect(row?.firstAuthor).toEqual({ name: "Ada Lovelace", email: "ada@new.example" });
    expect(row?.ownershipChanges).toEqual({ own: 2, other: 0, total: 2 });
  });

  it("surfaces gone-silent owner evidence without turning the row into a finding", () => {
    const advisory = buildOwnershipAdvisory({
      history: history([
        rec({
          hash: "new",
          authorName: "Bob",
          authorEmail: "bob@example.com",
          authorDate: "2026-06-01T00:00:00Z",
          files: [change("src/current.ts", 1, 0)],
        }),
        rec({
          hash: "owner-last",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          authorDate: "2026-01-01T00:00:00Z",
          files: [change("src/stale-owner.ts", 20, 0)],
        }),
        rec({
          hash: "owner-birth",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          authorDate: "2025-12-01T00:00:00Z",
          files: [change("src/stale-owner.ts", 20, 0)],
        }),
      ]),
      top: 10,
    });

    const row = advisory.sections[0]?.entries.find((entry) => entry.path === "src/stale-owner.ts");
    const text = formatOwnershipAdvisoryText(advisory);

    expect(row?.ownerRepoRecencyDays).toBe(151);
    expect(row?.ownerLastRepoCommitDate).toBe("2026-01-01T00:00:00Z");
    expect(text).toContain("drift:ai ownership (advisory, prototype lane)");
    expect(text).toContain("owner repo recency 151d");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("discloses bounded full-history caps and keeps JSON out of the findings shape", () => {
    const advisory = buildOwnershipAdvisory({
      history: history([rec({ hash: "c1", files: [change("src/capped.ts")] })], {
        partial: true,
        stoppedReason: "max-commits",
        moreHistoryMayExist: true,
        prototypeCaps: [
          {
            label: "full-history commits",
            limit: 1,
            hit: true,
            detail: "stopped after 1 commit(s); observed at least one older commit beyond the cap",
          },
        ],
      }),
    });

    const json = JSON.parse(formatOwnershipAdvisoryJson(advisory)) as Record<string, unknown>;

    expect(json["kind"]).toBe("advisory");
    expect(json["lane"]).toBe("prototype");
    expect(json["subcommand"]).toBe("ownership");
    expect("findings" in json).toBe(false);
    expect(advisory.caps[0]).toMatchObject({ label: "full-history commits", hit: true });
    expect(formatOwnershipAdvisoryText(advisory)).toContain("HIT -- PARTIAL run");
  });

  it("uses the default display cap", () => {
    const records = Array.from({ length: DEFAULT_OWNERSHIP_TOP + 2 }, (_, index) =>
      rec({
        hash: `h${index}`,
        authorName: `Author ${index}`,
        authorEmail: `author${index}@example.com`,
        files: [change(`src/${index}.ts`)],
      }),
    );

    const advisory = buildOwnershipAdvisory({ history: history(records) });

    expect(advisory.sections[0]?.totalCandidates).toBe(DEFAULT_OWNERSHIP_TOP + 2);
    expect(advisory.sections[0]?.entries).toHaveLength(DEFAULT_OWNERSHIP_TOP);
  });
});
