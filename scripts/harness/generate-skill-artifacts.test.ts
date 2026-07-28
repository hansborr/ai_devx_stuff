import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  formatSkillArtifactFailure,
  runSkillArtifactGenerator,
  SKILL_ARTIFACT_REPAIR_COMMAND,
  SkillArtifactValidationError,
} from "./generate-skill-artifacts.js";

const tmpRepo = registerTempRootCleanup();

afterEach(() => {
  vi.restoreAllMocks();
});

function manifest(): unknown {
  return {
    controls: [
      {
        id: "skill/example",
        kind: "skill",
        skillWiring: {
          canonical: ".claude/skills/example",
          targets: [
            { harness: "claude", path: ".claude/skills/example", overlays: [] },
            { harness: "codex", path: ".codex/skills/example", overlays: [] },
          ],
          gitignoreOptIns: [],
          smokeTest: "scripts/tests/test-skill.sh",
        },
      },
    ],
  };
}

function fixtureRoot(): string {
  return tmpRepo.writeRepo(
    {
      ".claude/skills/example/SKILL.md": "canonical\n",
      ".codex/skills/example/SKILL.md": "stale\n",
      ".gitignore": "",
      "scripts/tests/test-skill.sh":
        "#!/usr/bin/env bash\n# smoke-order: 010\n# smoke-subjects: scripts/tests/test-skill.sh\n",
      "scripts/path-policy/path-policy-smoke-subjects-data.ts": "stale data\n",
      "scripts/fixtures/test-scripts/all-smoke-tests.txt": "stale fixture\n",
    },
    "generate-skill-artifacts-",
  );
}

describe("skill artifact generator", () => {
  it("keeps check mode read-only and prints the one exact repair command", () => {
    const root = fixtureRoot();
    const targetPath = join(root, ".codex/skills/example/SKILL.md");
    const smokePath = join(root, "scripts/tests/test-skill.sh");
    const targetBefore = readFileSync(targetPath, "utf8");
    const smokeBefore = readFileSync(smokePath, "utf8");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });

    expect(runSkillArtifactGenerator(root, manifest(), true)).toBe(1);
    expect(errors.at(-1)).toBe(`Run \`${SKILL_ARTIFACT_REPAIR_COMMAND}\`.`);
    expect(errors.join("\n")).toContain("stale target file SKILL.md");
    expect(errors.join("\n")).toContain("generated skill smoke-subject block is stale");
    expect(readFileSync(targetPath, "utf8")).toBe(targetBefore);
    expect(readFileSync(smokePath, "utf8")).toBe(smokeBefore);
  });

  it("refreshes mirrors, the marked header, and existing downstream subject outputs", () => {
    const root = fixtureRoot();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(runSkillArtifactGenerator(root, manifest(), false)).toBe(0);
    expect(readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8")).toBe("canonical\n");
    const smoke = readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8");
    expect(smoke).toContain("# smoke-subjects: .claude/skills/example/SKILL.md");
    expect(smoke).toContain("# smoke-subjects: .codex/skills/example/SKILL.md");
    const data = readFileSync(
      join(root, "scripts/path-policy/path-policy-smoke-subjects-data.ts"),
      "utf8",
    );
    expect(data).toContain('".codex/skills/example/SKILL.md"');
    expect(
      readFileSync(join(root, "scripts/fixtures/test-scripts/all-smoke-tests.txt"), "utf8"),
    ).toBe("runner ran test-skill\n");
    expect(runSkillArtifactGenerator(root, manifest(), true)).toBe(0);
    expect(existsSync(join(root, ".codex/skills/example/.refresh"))).toBe(false);
  });

  it("does not prescribe refresh for pre-mutation validation failures", () => {
    let failure: unknown;
    try {
      runSkillArtifactGenerator(fixtureRoot(), { controls: [] }, false);
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(SkillArtifactValidationError);
    const message = formatSkillArtifactFailure(failure);

    expect(message).toContain("manifest declares no skill controls");
    expect(message).toContain("refresh cannot repair this failure");
    expect(message).not.toContain(SKILL_ARTIFACT_REPAIR_COMMAND);
  });

  it("prescribes refresh when output writing fails after mirror mutation", () => {
    const root = fixtureRoot();
    const generatedOutput = join(root, "scripts/path-policy/path-policy-smoke-subjects-data.ts");
    rmSync(generatedOutput);
    mkdirSync(generatedOutput);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    let failure: unknown;
    try {
      runSkillArtifactGenerator(root, manifest(), false);
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(SkillArtifactValidationError);
    expect(readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8")).toBe("canonical\n");
    const message = formatSkillArtifactFailure(failure);
    expect(message).toContain(SKILL_ARTIFACT_REPAIR_COMMAND);
    expect(message).not.toContain("refresh cannot repair this failure");
  });

  it("reports mode-only drift in check mode and repairs it on refresh", () => {
    const root = fixtureRoot();
    const canonicalPath = join(root, ".claude/skills/example/SKILL.md");
    const targetPath = join(root, ".codex/skills/example/SKILL.md");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    chmodSync(canonicalPath, 0o755);
    chmodSync(targetPath, 0o644);
    tmpRepo.writeRepoFile(root, ".codex/skills/example/SKILL.md", "canonical\n");

    expect(runSkillArtifactGenerator(root, manifest(), true)).toBe(1);
    expect(errors.join("\n")).toContain("target file mode drift SKILL.md: expected 755, got 644");

    expect(runSkillArtifactGenerator(root, manifest(), false)).toBe(0);
    expect(statSync(targetPath).mode & 0o777).toBe(0o755);
    expect(runSkillArtifactGenerator(root, manifest(), true)).toBe(0);
  });
});
