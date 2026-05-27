// @ts-check
import { describe, expect, it } from "vitest";

import {
  deriveLintedScriptReincludePatterns,
  lintedScriptFiles,
  lintedScriptReincludePatterns,
} from "../eslint-config/shared-policy.js";

const nonScriptReincludePatterns = [
  // This is a TS config file, not a linted runtime script. It is re-included
  // from the scripts ignore so the config-file policy can lint it.
  "!scripts/vitest.config.ts",
];

describe("shared lint policy", () => {
  it("derives script flat-config reinclude patterns from linted script files", () => {
    expect(lintedScriptReincludePatterns).toEqual([
      ...deriveLintedScriptReincludePatterns(lintedScriptFiles),
      ...nonScriptReincludePatterns,
    ]);
  });

  it("unignores globstar script directories before re-including their files", () => {
    expect(deriveLintedScriptReincludePatterns(["scripts/example/**/*.ts"])).toEqual([
      "!scripts/example/",
      "!scripts/example/**/*/",
      "!scripts/example/**/*.ts",
    ]);
  });

  it("maps exact and simple glob script entries directly to negated patterns", () => {
    expect(
      deriveLintedScriptReincludePatterns(["scripts/example.ts", "scripts/example-*.ts"]),
    ).toEqual(["!scripts/example.ts", "!scripts/example-*.ts"]);
  });
});
