import { describe, expect, it } from "vitest";

import { parseRows } from "./lint-coverage-map-check-patterns.js";
import {
  type CoverageRatchet,
  deriveDriftAiCoverageBlock,
  DRIFT_AI_END_MARKER,
  DRIFT_AI_START_MARKER,
  spliceDriftAiCoverageBlock,
} from "./lint-coverage-map-gen-core.js";

const HEADER =
  "| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |";

function ratchet(id: string, members: readonly string[]): CoverageRatchet {
  const membership = new Set(members);
  return { id, matches: (file) => membership.has(file) };
}

describe("deriveDriftAiCoverageBlock", () => {
  it("selects only tracked direct-child TypeScript and renders deterministic counts", async () => {
    const trackedFiles = [
      "scripts/drift-ai/z.test.ts",
      "scripts/drift-ai/fixtures/sample/nested.ts",
      "scripts/drift-ai/a.ts",
      "scripts/drift-ai/README.md",
      "scripts/drift-ai.ts",
    ];

    const block = await deriveDriftAiCoverageBlock({
      trackedFiles,
      isEslintReachable: () => true,
      ratchets: [
        ratchet("ratchet/z-test-only", ["scripts/drift-ai/z.test.ts"]),
        ratchet("ratchet/a-all", ["scripts/drift-ai/a.ts", "scripts/drift-ai/z.test.ts"]),
        ratchet("ratchet/unused", ["scripts/drift-ai/fixtures/sample/nested.ts"]),
      ],
    });

    expect(block).toContain(`${DRIFT_AI_START_MARKER}\n${HEADER}\n`);
    expect(block).toContain("| `scripts/drift-ai/*.ts` | 2 .ts | yes |");
    expect(block).toContain("`ratchet/a-all` (2/2 files); `ratchet/z-test-only` (1/2 files)");
    expect(block).not.toContain("ratchet/unused");
    expect(block).not.toContain("nested.ts");
    expect(block.endsWith(`${DRIFT_AI_END_MARKER}\n`)).toBe(true);
  });

  it("updates rendered ratchet membership when membership changes", async () => {
    const trackedFiles = ["scripts/drift-ai/a.ts", "scripts/drift-ai/b.test.ts"];
    const render = (members: readonly string[]): Promise<string> =>
      deriveDriftAiCoverageBlock({
        trackedFiles,
        isEslintReachable: () => true,
        ratchets: [ratchet("ratchet/tests", members)],
      });

    expect(await render(["scripts/drift-ai/b.test.ts"])).toContain("(1/2 files)");
    expect(await render(trackedFiles)).toContain("(2/2 files)");
    expect(await render([])).not.toContain("ratchet/tests");
  });

  it("fails closed and names every file missing ESLint reach", async () => {
    const trackedFiles = [
      "scripts/drift-ai/a.ts",
      "scripts/drift-ai/b.ts",
      "scripts/drift-ai/c.ts",
    ];

    await expect(
      deriveDriftAiCoverageBlock({
        trackedFiles,
        isEslintReachable: (file) => file === "scripts/drift-ai/a.ts",
        ratchets: [],
      }),
    ).rejects.toThrow(/scripts\/drift-ai\/b\.ts[\s\S]*scripts\/drift-ai\/c\.ts/u);
  });

  it("fails instead of rendering a vacuous row", async () => {
    await expect(
      deriveDriftAiCoverageBlock({
        trackedFiles: ["scripts/drift-ai.ts", "scripts/drift-ai/fixtures/a.ts"],
        isEslintReachable: () => true,
        ratchets: [],
      }),
    ).rejects.toThrow(/no tracked direct-child TypeScript files/u);
  });

  it("renders a row accepted by the existing coverage-map parser", async () => {
    const block = await deriveDriftAiCoverageBlock({
      trackedFiles: ["scripts/drift-ai/a.ts"],
      isEslintReachable: () => true,
      ratchets: [ratchet("ratchet/all", ["scripts/drift-ai/a.ts"])],
    });
    const rows = parseRows(block);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pathGroup: "`scripts/drift-ai/*.ts`",
      normalLint: "yes",
      ratchets: "`ratchet/all` (1/1 files)",
      status: "linted + ratcheted",
    });
  });
});

describe("spliceDriftAiCoverageBlock", () => {
  const block = `${DRIFT_AI_START_MARKER}\n${HEADER}\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${DRIFT_AI_END_MARKER}\n`;

  it("preserves every byte outside the marker span", () => {
    const source = `prefix\r\n${DRIFT_AI_START_MARKER}\nold\n${DRIFT_AI_END_MARKER}\r\nsuffix\r\n`;
    expect(spliceDriftAiCoverageBlock(source, block)).toBe(`prefix\r\n${block}suffix\r\n`);
  });

  it.each([
    ["missing start", `before\n${DRIFT_AI_END_MARKER}\nafter\n`],
    ["missing end", `before\n${DRIFT_AI_START_MARKER}\nafter\n`],
    [
      "duplicate start",
      `${DRIFT_AI_START_MARKER}\n${DRIFT_AI_START_MARKER}\n${DRIFT_AI_END_MARKER}\n`,
    ],
    ["duplicate end", `${DRIFT_AI_START_MARKER}\n${DRIFT_AI_END_MARKER}\n${DRIFT_AI_END_MARKER}\n`],
    ["reversed", `${DRIFT_AI_END_MARKER}\n${DRIFT_AI_START_MARKER}\n`],
    ["start not on its own line", `prefix ${DRIFT_AI_START_MARKER}\n${DRIFT_AI_END_MARKER}\n`],
    ["end not on its own line", `${DRIFT_AI_START_MARKER}\n${DRIFT_AI_END_MARKER} suffix\n`],
  ])("rejects %s marker structure", (_label, source) => {
    expect(() => spliceDriftAiCoverageBlock(source, block)).toThrow(/marker/u);
  });
});
