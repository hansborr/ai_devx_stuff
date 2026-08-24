import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(packageDir, "src");

function productionSources(): readonly string[] {
  return readdirSync(sourceDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".spec.ts"));
}

describe("workflow vocabulary boundary", () => {
  it("keeps host bun-run command literals out of every portable source layer", () => {
    const leaks = productionSources()
      .filter((path) => readFileSync(path, "utf8").includes("bun run"))
      .map((path) => relative(packageDir, path).split(sep).join("/"));

    expect(leaks).toEqual([]);
  });
});
