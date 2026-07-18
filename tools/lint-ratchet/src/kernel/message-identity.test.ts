import { describe, expect, it } from "vitest";

import corpus from "./fixtures/message-identity-golden.json";
import { messageIdentityForFinding } from "./message-identity.js";

describe("messageIdentityForFinding", () => {
  it("matches every messageId-less identity in the live collector golden corpus", () => {
    expect(corpus.entries).toHaveLength(21);

    for (const entry of corpus.entries) {
      expect(
        messageIdentityForFinding(
          entry.rawMessage,
          undefined,
          {
            filePath: entry.filePath,
            line: entry.line,
            column: entry.column,
          },
          corpus.capturedRepoRoot,
        ),
      ).toBe(entry.expectedIdentity);
    }
  });

  it("keeps semantic digit-and-pipe text and fails safe on malformed suffixes", () => {
    expect(corpus.negatives).toHaveLength(4);

    for (const entry of corpus.negatives) {
      expect(
        messageIdentityForFinding(
          entry.rawMessage,
          undefined,
          {
            filePath: entry.filePath,
            line: entry.line,
            column: entry.column,
          },
          corpus.capturedRepoRoot,
        ),
      ).toBe(entry.expectedIdentity);
    }
  });

  // Finding-1 lock: when a messageId is present it is the whole identity. This is
  // the deliberate machine-independence trade documented in messageIdentityForFinding;
  // these assertions pin it so a future edit cannot silently reintroduce the message
  // (which would flap on placeholders and re-baseline every messageId fingerprint).
  describe("messageId findings", () => {
    const location = { filePath: "/repo/packages/server/src/x.ts", line: 3, column: 7 } as const;

    it("keys identity on the messageId alone, ignoring the rendered message", () => {
      const withMessage = messageIdentityForFinding(
        "'foo' is defined but never used",
        "missingBoundary",
        location,
        "/repo",
      );
      const withDifferentMessage = messageIdentityForFinding(
        "'bar' is defined but never used",
        "missingBoundary",
        location,
        "/repo",
      );

      expect(withMessage).toBe(JSON.stringify({ messageId: "missingBoundary" }));
      // Same messageId + same count = same identity, regardless of message text.
      expect(withDifferentMessage).toBe(withMessage);
    });

    it("distinguishes different messageIds so cross-messageId swaps stay visible", () => {
      const missing = messageIdentityForFinding("same text", "missingBoundary", location, "/repo");
      const invalid = messageIdentityForFinding("same text", "invalidCategory", location, "/repo");

      expect(missing).not.toBe(invalid);
    });

    it("is independent of repo root and location, unlike the messageId-less path", () => {
      const here = messageIdentityForFinding(
        "msg /repo-a/pkg",
        "missingBoundary",
        location,
        "/repo-a",
      );
      const there = messageIdentityForFinding(
        "msg /repo-b/pkg",
        "missingBoundary",
        { filePath: "/repo-b/pkg/y.ts", line: 99, column: 1 },
        "/repo-b",
      );

      expect(here).toBe(there);
    });

    it("returns undefined only when neither message nor messageId is present", () => {
      expect(messageIdentityForFinding(undefined, undefined, location, "/repo")).toBeUndefined();
      expect(messageIdentityForFinding(undefined, "missingBoundary", location, "/repo")).toBe(
        JSON.stringify({ messageId: "missingBoundary" }),
      );
    });
  });

  // Finding-2 guard: an empty repo root must be a no-op. Without the length guard,
  // String.replaceAll("") inserts the token between every character and riddles the
  // identity, so a messageId-less finding with an empty root would never match.
  describe("empty repo root", () => {
    it("passes the message through unchanged instead of token-riddling it", () => {
      const message = "some/relative/path.ts uses a bad pattern";
      const location = { filePath: "some/relative/path.ts" } as const;

      const identity = messageIdentityForFinding(message, undefined, location, "");

      expect(identity).toBe(JSON.stringify({ message }));
      expect(identity).not.toContain("<repo-root>");
    });
  });
});
