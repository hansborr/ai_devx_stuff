import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { checkSkillInventory, refreshSkillInventory } from "./check-skill-inventory.js";

const tmpRepo = registerTempRootCleanup();

function manifest(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    controls: [
      {
        id: "skill/declared",
        kind: "skill",
        skillWiring: {
          canonical: ".claude/skills/declared",
          targets: [
            { harness: "claude", path: ".claude/skills/declared", overlays: [] },
            { harness: "codex", path: ".codex/skills/declared", overlays: [] },
          ],
          gitignoreOptIns: [],
          ...overrides,
        },
      },
    ],
  };
}

function fixtureRoot(): string {
  return tmpRepo.writeRepo(
    {
      ".claude/skills/declared/SKILL.md": "canonical\n",
      ".codex/skills/declared/SKILL.md": "stale\n",
      ".gitignore": "",
    },
    "skill-inventory-",
  );
}

describe("skill mirror inventory", () => {
  it("checks drift and refreshes through the same projection", () => {
    const root = fixtureRoot();

    expect(checkSkillInventory(root, manifest())).toContain(
      "skill/declared codex: stale target file SKILL.md",
    );
    refreshSkillInventory(root, manifest());

    expect(readFileSync(join(root, ".codex/skills/declared/SKILL.md"), "utf8")).toBe("canonical\n");
    expect(checkSkillInventory(root, manifest())).toEqual([]);
  });

  it("discovers ignored local skill roots absent from the manifest", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, ".claude/skills/local-only"));
    writeFileSync(join(root, ".claude/skills/local-only/SKILL.md"), "local\n");
    refreshSkillInventory(root, manifest());

    expect(checkSkillInventory(root, manifest())).toContain(
      "filesystem skill target is not inventoried: .claude/skills/local-only",
    );
  });

  it("rejects target roots that are symlinks or resolve outside the repository", () => {
    const container = tmpRepo.makeTempRepo("skill-inventory-containment-");
    const root = join(container, "repo");
    const external = join(container, "external");
    mkdirSync(join(root, ".claude/skills/declared"), { recursive: true });
    mkdirSync(join(root, ".codex/skills"), { recursive: true });
    mkdirSync(external, { recursive: true });
    writeFileSync(join(root, ".claude/skills/declared/SKILL.md"), "canonical\n");
    writeFileSync(join(root, ".gitignore"), "");
    symlinkSync(external, join(root, ".codex/skills/declared"), "dir");

    expect(() => checkSkillInventory(root, manifest())).toThrow(/symlink/u);
  });

  it("rejects the removed hand-maintained smokeSubjects field", () => {
    const root = fixtureRoot();

    expect(() => checkSkillInventory(root, manifest({ smokeSubjects: [] }))).toThrow(
      /unsupported field.*smokeSubjects/u,
    );
  });

  it("rejects duplicate target declarations", () => {
    const root = fixtureRoot();

    expect(() =>
      checkSkillInventory(
        root,
        manifest({
          targets: [
            { harness: "claude", path: ".claude/skills/declared", overlays: [] },
            { harness: "codex", path: ".codex/skills/declared", overlays: [] },
            { harness: "codex", path: ".codex/skills/other", overlays: [] },
          ],
        }),
      ),
    ).toThrow(/duplicate declaration: codex/u);
  });
});
