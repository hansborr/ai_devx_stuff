import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const adapterDir = resolve(dirname(fileURLToPath(import.meta.url)));
const authorityFile = join(adapterDir, "workflow-vocabulary.ts");

describe("Musi workflow vocabulary boundary", () => {
  it("keeps update-command literals in the adapter authority only", () => {
    const leaks = readdirSync(adapterDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name))
      .filter(
        (path) =>
          path !== authorityFile &&
          !path.endsWith(".test.ts") &&
          readFileSync(path, "utf8").includes("bun run lint:ratchet:update"),
      )
      .map((path) => relative(adapterDir, path).split(sep).join("/"));

    expect(leaks).toEqual([]);
  });
});
