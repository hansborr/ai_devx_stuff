import { describe, expect, it } from "vitest";

import { parseClassConstructionArgs } from "./class-construction-args.js";
import { parseCloneCandidatesArgs } from "./clone-candidates-args.js";
import { parseDolosCandidatesArgs } from "./dolos-candidates-args.js";
import { DriftAiError } from "./errors.js";

describe("prototype root-taking args", () => {
  const rootTakingParsers = [
    ["clone-candidates", parseCloneCandidatesArgs],
    ["class-construction", parseClassConstructionArgs],
    ["dolos-candidates", parseDolosCandidatesArgs],
  ] as const;

  for (const [subcommand, parse] of rootTakingParsers) {
    it(`rejects empty --root= for ${subcommand}`, () => {
      expect(() => parse(["--root="])).toThrow(DriftAiError);
      expect(() => parse(["--root="])).toThrow(/--root requires a path/u);
    });
  }
});
