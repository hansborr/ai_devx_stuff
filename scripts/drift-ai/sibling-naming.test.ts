import { describe, expect, it } from "vitest";

import { loadDeadCodeCorpusLabels } from "./dead-code-corpus.js";
import {
  classifySiblingMarker,
  classifySiblingPair,
  findSiblingVariantPairs,
  resolveSiblingNamingConfig,
  SIBLING_NAMING_STANDING_CAVEAT,
  type SiblingCaveatLabeler,
  type SiblingMarker,
  type SiblingNamingPair,
  siblingPathCaveats,
  tokenizeSiblingName,
} from "./sibling-naming.js";

const config = resolveSiblingNamingConfig();

function allMarkers(pair: SiblingNamingPair | undefined): SiblingMarker[] {
  return pair === undefined ? [] : [...pair.leftMarkers, ...pair.rightMarkers];
}

describe("tokenizeSiblingName", () => {
  it("keeps a v-number version run intact across separators and camelCase", () => {
    expect(tokenizeSiblingName("encounter-format-v2.ts")).toEqual(["encounter", "format", "v2"]);
    expect(tokenizeSiblingName("AuthServiceV2.ts")).toEqual(["auth", "service", "v2"]);
  });

  it("splits prefix markers and dotted backup markers", () => {
    expect(tokenizeSiblingName("old-auth.ts")).toEqual(["old", "auth"]);
    expect(tokenizeSiblingName("report.backup.ts")).toEqual(["report", "backup"]);
  });
});

describe("classifySiblingMarker", () => {
  it("recognizes version, lifecycle, and copy/backup markers", () => {
    expect(classifySiblingMarker("v2", config)).toBe("version");
    expect(classifySiblingMarker("v10", config)).toBe("version");
    expect(classifySiblingMarker("old", config)).toBe("lifecycle");
    expect(classifySiblingMarker("legacy", config)).toBe("lifecycle");
    expect(classifySiblingMarker("backup", config)).toBe("copy-backup");
    expect(classifySiblingMarker("bak", config)).toBe("copy-backup");
  });

  it("does not treat ordinary tokens or bare numbers as markers", () => {
    expect(classifySiblingMarker("helper", config)).toBeUndefined();
    expect(classifySiblingMarker("v", config)).toBeUndefined();
    expect(classifySiblingMarker("2", config)).toBeUndefined();
    expect(classifySiblingMarker("version2", config)).toBeUndefined();
  });

  it("honors a configurable seed marker set", () => {
    const custom = resolveSiblingNamingConfig({ lifecycle: ["fork"] });
    expect(classifySiblingMarker("fork", custom)).toBe("lifecycle");
    // Default lifecycle tokens drop out when the seed set is overridden.
    expect(classifySiblingMarker("old", custom)).toBeUndefined();
  });
});

describe("classifySiblingPair", () => {
  it("flags a versioned suffix variant over a plain base", () => {
    const pair = classifySiblingPair("src/config.ts", "src/config-v2.ts");
    expect(pair?.relation).toBe("plain-vs-marked");
    expect(pair?.sharedTokens).toEqual(["config"]);
    expect(allMarkers(pair)).toEqual([{ token: "v2", kind: "version", position: "suffix" }]);
  });

  it("flags a legacy prefix variant and records the prefix position", () => {
    const pair = classifySiblingPair("src/auth.ts", "src/legacy-auth.ts");
    expect(pair?.relation).toBe("plain-vs-marked");
    expect(allMarkers(pair)).toEqual([{ token: "legacy", kind: "lifecycle", position: "prefix" }]);
  });

  it("flags a dotted backup variant", () => {
    const pair = classifySiblingPair("src/report.ts", "src/report.backup.ts");
    expect(pair?.relation).toBe("plain-vs-marked");
    expect(allMarkers(pair)[0]?.kind).toBe("copy-backup");
  });

  it("flags two versioned siblings as marked-vs-marked, keeping a shared marker base", () => {
    // `config` is the non-marker base; `v2`/`v3` differ. A shared marker token
    // (none here) would be fine too as long as a non-marker base is also shared.
    const pair = classifySiblingPair("src/config-v2.ts", "src/config-v3.ts");
    expect(pair?.relation).toBe("marked-vs-marked");
    expect(pair?.leftMarkers[0]?.token).toBe("v2");
    expect(pair?.rightMarkers[0]?.token).toBe("v3");
  });

  it("records an infix marker position when the marker sits between base tokens", () => {
    const pair = classifySiblingPair("src/config-old.ts", "src/config-v2-old.ts");
    expect(pair?.relation).toBe("plain-vs-marked");
    expect(allMarkers(pair)).toEqual([{ token: "v2", kind: "version", position: "infix" }]);
  });

  it("attributes each occurrence of a repeated marker to its real position", () => {
    const pair = classifySiblingPair("src/svc.ts", "src/old-svc-old.ts");
    expect(allMarkers(pair)).toEqual([
      { token: "old", kind: "lifecycle", position: "prefix" },
      { token: "old", kind: "lifecycle", position: "suffix" },
    ]);
  });

  it("ignores a sibling whose differing token is not a marker", () => {
    expect(classifySiblingPair("src/auth.ts", "src/auth-helper.ts")).toBeUndefined();
  });

  it("ignores a pair whose only shared token is itself a marker", () => {
    // `old` is shared but is a marker, so there is no real base to fork from.
    expect(classifySiblingPair("src/old.ts", "src/old-config.ts")).toBeUndefined();
  });

  it("ignores identical names that differ only by extension", () => {
    expect(classifySiblingPair("src/auth.ts", "src/auth.tsx")).toBeUndefined();
  });

  it("still emits benign API vocabulary as a lead, carrying the standing caveat", () => {
    const pair = classifySiblingPair("src/character.tsx", "src/new-character.tsx");
    expect(pair).toBeDefined();
    expect(pair?.caveats).toContain(SIBLING_NAMING_STANDING_CAVEAT);
  });
});

describe("siblingPathCaveats", () => {
  it("labels test-only, barrel, and framework-entry contexts from path conventions", () => {
    expect(siblingPathCaveats("src/foo.test.ts")[0]).toContain("test-only");
    expect(siblingPathCaveats("src/index.ts")[0]).toContain("public-api");
    expect(siblingPathCaveats("app/routes/home.tsx")[0]).toContain("framework-entrypoint");
    expect(siblingPathCaveats("src/home-route.tsx")[0]).toContain("framework-entrypoint");
  });

  it("returns no path caveats for an ordinary source file", () => {
    expect(siblingPathCaveats("src/auth.ts")).toEqual([]);
  });
});

describe("findSiblingVariantPairs", () => {
  it("returns pairs deterministically ordered by left then right path", () => {
    const pairs = findSiblingVariantPairs([
      "src/config-v3.ts",
      "src/auth-legacy.ts",
      "src/config-v2.ts",
      "src/auth.ts",
    ]);
    expect(pairs.map((pair) => `${pair.leftPath}|${pair.rightPath}`)).toEqual([
      "src/auth-legacy.ts|src/auth.ts",
      "src/config-v2.ts|src/config-v3.ts",
    ]);
  });

  it("carries the standing caveat on every emitted pair", () => {
    const pairs = findSiblingVariantPairs(["a/svc.ts", "a/svc-old.ts"]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.caveats).toContain(SIBLING_NAMING_STANDING_CAVEAT);
  });
});

describe("dead-code FP-trap corpus calibration", () => {
  const labels = loadDeadCodeCorpusLabels();
  const trapPaths = [
    ...new Set(labels.labels.filter((l) => l.kind === "true-trap").map((l) => l.path)),
  ];
  const trapLabeler: SiblingCaveatLabeler = (filePath) =>
    labels.labels
      .filter((label) => label.path === filePath)
      .map((label) => `${label.kind}: ${label.reason}`);

  it("has true-trap fixtures to calibrate against", () => {
    expect(trapPaths.length).toBeGreaterThan(0);
  });

  // The dangerous case: a variant marker (`-legacy`) sits beside a file that is
  // only reachable through a barrel, dynamic import, reflection, or framework
  // convention. The pair must preserve that trap label so it can never read as
  // "the legacy sibling replaced a dead file -- delete it".
  it("preserves a true-trap label onto a variant pair beside the trap file", () => {
    for (const trapPath of trapPaths) {
      const variant = withLegacySuffix(trapPath);
      const pair = classifySiblingPair(trapPath, variant, { caveatLabeler: trapLabeler });
      expect(pair, trapPath).toBeDefined();
      expect(pair?.relation).toBe("plain-vs-marked");
      expect(pair?.caveats).toContain(SIBLING_NAMING_STANDING_CAVEAT);
      expect(pair?.caveats.some((caveat) => caveat.startsWith("true-trap:"))).toBe(true);
    }
  });

  it("keeps a barrel trap's path-convention caveat alongside the injected trap label", () => {
    const barrel = "barrel/index.ts";
    expect(trapPaths).toContain(barrel);
    const pair = classifySiblingPair(barrel, withLegacySuffix(barrel), {
      caveatLabeler: trapLabeler,
    });
    expect(pair?.caveats.some((caveat) => caveat.startsWith("risky-context: public-api"))).toBe(
      true,
    );
    expect(pair?.caveats.some((caveat) => caveat.startsWith("true-trap:"))).toBe(true);
  });
});

function withLegacySuffix(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return `${filePath.slice(0, dot)}-legacy${filePath.slice(dot)}`;
}
