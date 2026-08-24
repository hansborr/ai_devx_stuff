import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWLIST_SLUG_MAX_LENGTH,
  ALLOWLIST_WORKER_KEY_MAX_LENGTH,
} from "../packages/server/src/test/prepare-test-db.js";

const worktreeDbSource = readFileSync(resolve(import.meta.dirname, "worktree-db.sh"), "utf8");

function readonlyInteger(name: string): number {
  const match = new RegExp(`^readonly ${name}=(\\d+)$`, "m").exec(worktreeDbSource);
  expect(match, `readonly ${name}=<integer>`).not.toBeNull();
  return Number(match?.[1]);
}

describe("worktree database naming constants", () => {
  it("keeps the shell producer bounds aligned with the destructive TypeScript allowlist", () => {
    expect(readonlyInteger("SLUG_MAX_LEN")).toBe(ALLOWLIST_SLUG_MAX_LENGTH);
    expect(readonlyInteger("WORKER_KEY_MAX_LEN")).toBe(ALLOWLIST_WORKER_KEY_MAX_LENGTH);
  });

  it("pins the shell producer alphabets used by the TypeScript allowlist", () => {
    expect(worktreeDbSource).toContain("sed 's/[^a-z0-9_]/_/g'");
    expect(worktreeDbSource).toContain("_w[a-z0-9]{1,${WORKER_KEY_MAX_LEN}}");
  });
});
