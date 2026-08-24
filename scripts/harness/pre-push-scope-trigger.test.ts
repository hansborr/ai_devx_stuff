import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildNearDuplicatesTriggerPattern,
  NEAR_DUPLICATES_TRIGGER_FILES,
  PRE_PUSH_SCOPE_TRIGGER_VARIABLE,
  readNearDuplicatesScannerExtensions,
  renderPrePushScopeTriggerShell,
} from "./pre-push-scope-trigger.js";

const SCANNER_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Mirrors how `.husky/pre-push` applies the trigger: `grep -qE "$pattern"`. */
function matches(pattern: string, path: string): boolean {
  return new RegExp(pattern, "u").test(path);
}

const roots: string[] = [];

function makeConfigRoot(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "musi-pre-push-trigger-"));
  roots.push(root);
  writeFileSync(join(root, "drift-ai.config.json"), JSON.stringify(config), "utf8");
  return root;
}

describe("pre-push near-duplicates scope trigger", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it("carries the whole ERE: both whole-file triggers and the extension half", () => {
    const pattern = buildNearDuplicatesTriggerPattern(SCANNER_EXTENSIONS);
    for (const file of NEAR_DUPLICATES_TRIGGER_FILES) {
      expect(matches(pattern, file)).toBe(true);
      expect(matches(pattern, `nested/dir/${file}`)).toBe(true);
    }
    for (const extension of SCANNER_EXTENSIONS) {
      expect(matches(pattern, `packages/server/src/thing${extension}`)).toBe(true);
    }
  });

  it("does not trigger on unrelated docs or config paths", () => {
    const pattern = buildNearDuplicatesTriggerPattern(SCANNER_EXTENSIONS);
    for (const path of [
      "docs/guides/lint-ratchet.md",
      "package.json",
      "notdrift-ai.config.json",
      "sensor-near-duplicates.baseline.json.bak",
      "src/thing.tsx.snap",
    ]) {
      expect(matches(pattern, path)).toBe(false);
    }
  });

  it("tracks whatever extension set it is given", () => {
    expect(matches(buildNearDuplicatesTriggerPattern(new Set([".ts"])), "a.js")).toBe(false);
  });

  // Through the real config reader, not an injected set: a reader regression
  // could otherwise drop configured extensions while the generated fragment
  // stayed "fresh" against its own (wrong) input.
  it("reads config-added extensions out of drift-ai.config.json", () => {
    const root = makeConfigRoot({ additionalSourceExtensions: [".mts", "svelte"] });
    const pattern = buildNearDuplicatesTriggerPattern(readNearDuplicatesScannerExtensions(root));

    expect(matches(pattern, "scripts/thing.mts")).toBe(true);
    expect(matches(pattern, "app/Thing.svelte")).toBe(true);
    for (const extension of SCANNER_EXTENSIONS) {
      expect(matches(pattern, `packages/server/src/thing${extension}`)).toBe(true);
    }
  });

  it("falls back to the built-in extensions for an unusable config", () => {
    for (const body of ["[]", "null", "not json at all", '{"additionalSourceExtensions": "mts"}']) {
      const root = mkdtempSync(join(tmpdir(), "musi-pre-push-trigger-"));
      roots.push(root);
      writeFileSync(join(root, "drift-ai.config.json"), body, "utf8");

      expect([...readNearDuplicatesScannerExtensions(root)].sort()).toEqual(
        [...SCANNER_EXTENSIONS].sort(),
      );
    }
  });

  it("ERE-escapes regex-significant extensions the scanner config can add", () => {
    const pattern = buildNearDuplicatesTriggerPattern(new Set([".ts", ".c++"]));
    expect(pattern).toContain(String.raw`c\+\+`);
    expect(matches(pattern, "vendor/thing.c++")).toBe(true);
    expect(matches(pattern, "vendor/thingXcXX")).toBe(false);
  });

  it("renders a sourceable shell fragment defining the hook's trigger variable", () => {
    const rendered = renderPrePushScopeTriggerShell(SCANNER_EXTENSIONS);
    expect(rendered).toContain("# shellcheck shell=bash");
    expect(rendered).toContain("Do not edit by hand");
    expect(rendered).toContain("bun run harness:pre-push-trigger");
    expect(rendered).toMatch(
      new RegExp(String.raw`^${PRE_PUSH_SCOPE_TRIGGER_VARIABLE}='.+'$`, "mu"),
    );
    expect(rendered.endsWith("\n")).toBe(true);
  });
});
