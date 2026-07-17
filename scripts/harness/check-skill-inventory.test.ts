import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkSkillInventory,
  compareSkillTrees,
  type SkillOverlay,
} from "./check-skill-inventory.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function fixtureTrees(): { readonly canonical: string; readonly target: string } {
  const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
  roots.push(root);
  const canonical = join(root, "claude");
  const target = join(root, "codex");
  mkdirSync(canonical, { recursive: true });
  mkdirSync(target, { recursive: true });
  return { canonical, target };
}

describe("skill mirror inventory", () => {
  it("permits only the declared frontmatter field overlay", () => {
    const { canonical, target } = fixtureTrees();
    writeFileSync(
      join(canonical, "SKILL.md"),
      "---\nname: graph\nallowed-tools: Bash(graph)\n---\n\n# Graph\n",
    );
    writeFileSync(join(target, "SKILL.md"), "---\nname: graph\n---\n\n# Graph\n");
    const overlays: readonly SkillOverlay[] = [
      { path: "SKILL.md", kind: "frontmatter-field", field: "allowed-tools" },
    ];

    expect(compareSkillTrees(canonical, target, overlays)).toEqual([]);

    writeFileSync(join(target, "SKILL.md"), "---\nname: graph\n---\n\n# Different\n");
    expect(compareSkillTrees(canonical, target, overlays)).toContain(
      "SKILL.md differs outside permitted frontmatter field allowed-tools",
    );
  });

  it("requires an actual frontmatter block before stripping an allowed field", () => {
    const { canonical, target } = fixtureTrees();
    writeFileSync(
      join(canonical, "SKILL.md"),
      "name: graph\nallowed-tools: Bash(graph)\n---\n\n# Graph\n",
    );
    writeFileSync(join(target, "SKILL.md"), "name: graph\n---\n\n# Graph\n");

    expect(
      compareSkillTrees(canonical, target, [
        { path: "SKILL.md", kind: "frontmatter-field", field: "allowed-tools" },
      ]),
    ).toContain("SKILL.md must contain an opening and closing frontmatter block in each target");
  });

  it("rejects an undeclared target-only metadata file", () => {
    const { canonical, target } = fixtureTrees();
    writeFileSync(join(canonical, "SKILL.md"), "same\n");
    writeFileSync(join(target, "SKILL.md"), "same\n");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(join(target, "agents/openai.yaml"), "interface:\n");

    expect(compareSkillTrees(canonical, target, [])).toContain(
      "agents/openai.yaml exists only in target without a permitted overlay",
    );
    expect(compareSkillTrees(canonical, target, [{ path: "agents", kind: "target-only" }])).toEqual(
      [],
    );
  });

  it("rejects a forbidden-side overlay path even when both copies are byte-identical", () => {
    const { canonical, target } = fixtureTrees();
    mkdirSync(join(canonical, "scripts"));
    mkdirSync(join(target, "scripts"));
    writeFileSync(join(canonical, "scripts/run.sh"), "same\n");
    writeFileSync(join(target, "scripts/run.sh"), "same\n");

    expect(
      compareSkillTrees(canonical, target, [{ path: "scripts", kind: "canonical-only" }]),
    ).toContain("scripts/run.sh is forbidden in target by its canonical-only overlay");
  });

  it("fails closed when a mirrored skill tree contains a symlink", () => {
    const { canonical, target } = fixtureTrees();
    writeFileSync(join(canonical, "SKILL.md"), "same\n");
    writeFileSync(join(target, "SKILL.md"), "same\n");
    symlinkSync("SKILL.md", join(canonical, "linked.md"));

    expect(compareSkillTrees(canonical, target, [])).toContain(
      "canonical skill tree contains unsupported symlink: linked.md",
    );
  });

  it("rejects a symlink used as the top-level comparison root", () => {
    const { canonical, target } = fixtureTrees();
    const physicalCanonical = `${canonical}-physical`;
    mkdirSync(physicalCanonical);
    writeFileSync(join(physicalCanonical, "SKILL.md"), "same\n");
    writeFileSync(join(target, "SKILL.md"), "same\n");
    rmSync(canonical, { recursive: true });
    symlinkSync(physicalCanonical, canonical, "dir");

    expect(() => compareSkillTrees(canonical, target, [])).toThrow(
      "canonical skill root must not be a symlink",
    );
  });

  it("rejects declared skill roots that resolve outside the repository", () => {
    const container = mkdtempSync(join(tmpdir(), "skill-inventory-containment-"));
    roots.push(container);
    const root = join(container, "repo");
    const externalClaude = join(container, "external-claude");
    for (const path of [
      join(root, ".codex/skills/declared"),
      join(root, "scripts/tests"),
      join(externalClaude, "skills/declared"),
    ]) {
      mkdirSync(path, { recursive: true });
    }
    symlinkSync(externalClaude, join(root, ".claude"), "dir");
    writeFileSync(join(root, ".gitignore"), "");
    writeFileSync(join(externalClaude, "skills/declared/SKILL.md"), "same\n");
    writeFileSync(join(root, ".codex/skills/declared/SKILL.md"), "same\n");

    expect(() =>
      checkSkillInventory(root, {
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
              smokeSubjects: [],
            },
          },
        ],
      }),
    ).toThrow("skill/declared.canonical resolves outside repo root");
  });

  it("rejects a declared top-level skill root symlink", () => {
    const container = mkdtempSync(join(tmpdir(), "skill-inventory-root-link-"));
    roots.push(container);
    const root = join(container, "repo");
    const externalCanonical = join(container, "external-canonical");
    for (const path of [
      join(root, ".claude/skills"),
      join(root, ".codex/skills/declared"),
      join(root, "scripts/tests"),
      externalCanonical,
    ]) {
      mkdirSync(path, { recursive: true });
    }
    symlinkSync(externalCanonical, join(root, ".claude/skills/declared"), "dir");
    writeFileSync(join(root, ".gitignore"), "");
    writeFileSync(join(externalCanonical, "SKILL.md"), "same\n");
    writeFileSync(join(root, ".codex/skills/declared/SKILL.md"), "same\n");

    expect(() =>
      checkSkillInventory(root, {
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
              smokeSubjects: [],
            },
          },
        ],
      }),
    ).toThrow("skill/declared.canonical must not be a symlink");
  });

  it("discovers ignored local skill roots that are absent from the manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-repo-"));
    roots.push(root);
    for (const path of [
      ".claude/skills/declared",
      ".codex/skills/declared",
      ".claude/skills/local-only",
      "scripts/tests",
    ]) {
      mkdirSync(join(root, path), { recursive: true });
    }
    writeFileSync(join(root, ".gitignore"), "");
    writeFileSync(join(root, ".claude/skills/declared/SKILL.md"), "same\n");
    writeFileSync(join(root, ".codex/skills/declared/SKILL.md"), "same\n");
    writeFileSync(join(root, ".claude/skills/local-only/SKILL.md"), "local\n");

    const failures = checkSkillInventory(root, {
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
            smokeSubjects: [],
          },
        },
      ],
    });

    expect(failures).toContain(
      "filesystem skill target is not inventoried: .claude/skills/local-only",
    );
  });
});
