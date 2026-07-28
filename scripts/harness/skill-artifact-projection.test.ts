import { chmodSync, existsSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  diffSkillArtifactProjection,
  materializeSkillArtifactProjection,
  projectSkillArtifacts,
  SKILL_SMOKE_SUBJECTS_BEGIN,
  SKILL_SMOKE_SUBJECTS_END,
} from "./skill-artifact-projection.js";

const tmpRepo = registerTempRootCleanup();

interface TargetFixture {
  readonly harness: string;
  readonly path: string;
  readonly overlays: readonly Record<string, string>[];
}

function manifestFor(
  targets: readonly TargetFixture[],
  smokeTest = "scripts/tests/test-skill.sh",
): unknown {
  return {
    controls: [
      {
        id: "skill/example",
        kind: "skill",
        skillWiring: {
          canonical: ".claude/skills/example",
          targets,
          gitignoreOptIns: [],
          smokeTest,
        },
      },
    ],
  };
}

function sharedTargets(overlays: readonly Record<string, string>[] = []): readonly TargetFixture[] {
  return [
    { harness: "claude", path: ".claude/skills/example", overlays: [] },
    { harness: "codex", path: ".codex/skills/example", overlays },
  ];
}

function writeRepo(files: Readonly<Record<string, string>>, prefix: string): string {
  return tmpRepo.writeRepo(files, prefix);
}

describe("skill artifact projection", () => {
  it("projects ordinary files and every overlay kind into a generated smoke block", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md":
          "---\nname: example\nallowed-tools: Bash(example)\n---\n\n# Example\n",
        ".claude/skills/example/TARGET.md": "---\nname: target\n---\n\n# Target\n",
        ".claude/skills/example/GUIDE.md":
          "shared before\n<!-- BEGIN HARNESS-SPECIFIC: claude -->\nclaude prose\n<!-- END HARNESS-SPECIFIC -->\nshared after\n",
        ".claude/skills/example/references/a.md": "shared reference\n",
        ".claude/skills/example/scripts/run.sh": "#!/bin/sh\n",
        ".codex/skills/example/SKILL.md": "---\nname: stale\n---\n\n# Stale\n",
        ".codex/skills/example/TARGET.md":
          "---\nname: target\ntarget-note: keep this value\n---\n\n# stale\n",
        ".codex/skills/example/GUIDE.md":
          "old shared\n<!-- BEGIN HARNESS-SPECIFIC: codex -->\ncodex prose\n<!-- END HARNESS-SPECIFIC -->\nold tail\n",
        ".codex/skills/example/agents/openai.yaml": "interface:\n  display_name: Example\n",
        ".codex/skills/example/stale.md": "delete me\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-order: 5\n# smoke-subjects: scripts/tests/test-skill.sh\nexit 0\n",
        ".gitignore": "",
      },
      "skill-projection-all-overlays-",
    );
    const manifest = manifestFor(
      sharedTargets([
        { path: "SKILL.md", kind: "frontmatter-field", field: "allowed-tools" },
        { path: "TARGET.md", kind: "frontmatter-field", field: "target-note" },
        { path: "GUIDE.md", kind: "harness-block" },
        { path: "scripts", kind: "canonical-only" },
        { path: "agents", kind: "target-only" },
      ]),
    );

    const before = projectSkillArtifacts(root, manifest);
    expect(diffSkillArtifactProjection(root, before)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stale.md"),
        expect.stringContaining("generated skill smoke-subject block"),
      ]),
    );

    materializeSkillArtifactProjection(root, before);

    expect(readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8")).toBe(
      "---\nname: example\n---\n\n# Example\n",
    );
    expect(readFileSync(join(root, ".codex/skills/example/TARGET.md"), "utf8")).toBe(
      "---\nname: target\ntarget-note: keep this value\n---\n\n# Target\n",
    );
    expect(readFileSync(join(root, ".codex/skills/example/GUIDE.md"), "utf8")).toBe(
      "shared before\n<!-- BEGIN HARNESS-SPECIFIC: codex -->\ncodex prose\n<!-- END HARNESS-SPECIFIC -->\nshared after\n",
    );
    expect(readFileSync(join(root, ".codex/skills/example/agents/openai.yaml"), "utf8")).toBe(
      "interface:\n  display_name: Example\n",
    );
    expect(existsSync(join(root, ".codex/skills/example/scripts/run.sh"))).toBe(false);
    expect(existsSync(join(root, ".codex/skills/example/stale.md"))).toBe(false);

    const smoke = readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8");
    expect(smoke).toContain(SKILL_SMOKE_SUBJECTS_BEGIN);
    expect(smoke).toContain(SKILL_SMOKE_SUBJECTS_END);
    expect(smoke).toContain("# smoke-subjects: .codex/skills/example/agents/openai.yaml");
    expect(smoke).toContain("# smoke-subjects: .claude/skills/example/scripts/run.sh");
    expect(smoke).not.toContain("# smoke-subjects: .codex/skills/example/scripts/run.sh");
    expect(smoke).toContain("# smoke-subjects: scripts/tests/test-skill.sh");
  });

  it("rejects same-path and nested overlays before writing", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "same\n",
        ".codex/skills/example/SKILL.md": "stale\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-overlap-",
    );
    const targetBefore = readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8");
    const headerBefore = readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8");

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(
          sharedTargets([
            { path: "SKILL.md", kind: "canonical-only" },
            { path: "SKILL.md", kind: "target-only" },
          ]),
        ),
      ),
    ).toThrow(/overlap/u);
    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(
          sharedTargets([
            { path: "references", kind: "canonical-only" },
            { path: "references/nested.md", kind: "target-only" },
          ]),
        ),
      ),
    ).toThrow(/overlap/u);
    expect(readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8")).toBe(targetBefore);
    expect(readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8")).toBe(headerBefore);
  });

  it("refuses target bootstrap when authored overlay input is required", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "same\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-bootstrap-refusal-",
    );

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(sharedTargets([{ path: "agents", kind: "target-only" }])),
      ),
    ).toThrow(/target-only.*seed/u);
    expect(existsSync(join(root, ".codex/skills/example"))).toBe(false);

    const frontmatterRoot = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "---\nname: example\n---\n\n# Example\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-frontmatter-bootstrap-refusal-",
    );
    expect(() =>
      projectSkillArtifacts(
        frontmatterRoot,
        manifestFor(
          sharedTargets([{ path: "SKILL.md", kind: "frontmatter-field", field: "target-note" }]),
        ),
      ),
    ).toThrow(/target-owned frontmatter.*seed/u);
    expect(existsSync(join(frontmatterRoot, ".codex/skills/example"))).toBe(false);
  });

  it("bootstraps a fully derivable target and is deterministic and idempotent", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md":
          "---\nname: example\nallowed-tools: Bash(example)\n---\n\n# Example\n",
        ".claude/skills/example/scripts/run.sh": "#!/bin/sh\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-bootstrap-",
    );
    const manifest = manifestFor(
      sharedTargets([
        { path: "SKILL.md", kind: "frontmatter-field", field: "allowed-tools" },
        { path: "scripts", kind: "canonical-only" },
      ]),
    );

    const first = projectSkillArtifacts(root, manifest);
    materializeSkillArtifactProjection(root, first);
    const targetAfterFirst = readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8");
    const headerAfterFirst = readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8");
    const second = projectSkillArtifacts(root, manifest);

    expect(diffSkillArtifactProjection(root, second)).toEqual([]);
    materializeSkillArtifactProjection(root, second);
    expect(readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8")).toBe(
      targetAfterFirst,
    );
    expect(readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8")).toBe(headerAfterFirst);
  });

  it("preserves the smoke test mode when refreshing its generated block", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "same\n",
        ".codex/skills/example/SKILL.md": "same\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-smoke-mode-",
    );
    const smokeTest = join(root, "scripts/tests/test-skill.sh");
    chmodSync(smokeTest, 0o755);

    const previousUmask = process.umask(0o777);
    try {
      materializeSkillArtifactProjection(
        root,
        projectSkillArtifacts(root, manifestFor(sharedTargets())),
      );
    } finally {
      process.umask(previousUmask);
    }

    expect(statSync(smokeTest).mode & 0o777).toBe(0o755);
  });

  it("compares and repairs mirrored-file executable status only", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "same\n",
        ".claude/skills/example/scripts/run.sh": "#!/bin/sh\n",
        ".codex/skills/example/SKILL.md": "same\n",
        ".codex/skills/example/scripts/run.sh": "#!/bin/sh\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-mode-drift-",
    );
    const canonicalScript = join(root, ".claude/skills/example/scripts/run.sh");
    const targetScript = join(root, ".codex/skills/example/scripts/run.sh");
    chmodSync(canonicalScript, 0o644);
    chmodSync(targetScript, 0o664);
    const projection = projectSkillArtifacts(root, manifestFor(sharedTargets()));

    expect(
      diffSkillArtifactProjection(root, projection).filter((failure) =>
        failure.includes("target file mode drift"),
      ),
    ).toEqual([]);

    chmodSync(targetScript, 0o755);
    expect(diffSkillArtifactProjection(root, projection)).toContain(
      "skill/example codex: target file mode drift scripts/run.sh: expected 644, got 755",
    );

    materializeSkillArtifactProjection(root, projection);

    expect(statSync(targetScript).mode & 0o777).toBe(0o644);
    expect(
      diffSkillArtifactProjection(root, projectSkillArtifacts(root, manifestFor(sharedTargets()))),
    ).toEqual([]);
  });

  it("rejects malformed frontmatter delimiters for a frontmatter overlay", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md":
          "name: example\nallowed-tools: Bash(example)\n---\n\n# Example\n",
        ".codex/skills/example/SKILL.md": "name: example\n---\n\n# Example\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-frontmatter-delimiters-",
    );

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(
          sharedTargets([{ path: "SKILL.md", kind: "frontmatter-field", field: "allowed-tools" }]),
        ),
      ),
    ).toThrow(/canonical file must contain valid frontmatter/u);
  });

  it("rejects a canonical-only file that appears in the target", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "same\n",
        ".claude/skills/example/scripts/run.sh": "same\n",
        ".codex/skills/example/SKILL.md": "same\n",
        ".codex/skills/example/scripts/run.sh": "same\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-canonical-only-target-",
    );

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(sharedTargets([{ path: "scripts", kind: "canonical-only" }])),
      ),
    ).toThrow(/scripts\/run\.sh is forbidden in target by its canonical-only overlay/u);
  });

  it("rejects wrong harness block labels, symlinks, and repo-root escapes without mutation", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md":
          "<!-- BEGIN HARNESS-SPECIFIC: claude -->\nclaude\n<!-- END HARNESS-SPECIFIC -->\n",
        ".codex/skills/example/SKILL.md":
          "<!-- BEGIN HARNESS-SPECIFIC: cursor -->\ncodex\n<!-- END HARNESS-SPECIFIC -->\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-invalid-input-",
    );
    const targetPath = join(root, ".codex/skills/example/SKILL.md");
    const before = readFileSync(targetPath, "utf8");

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(sharedTargets([{ path: "SKILL.md", kind: "harness-block" }])),
      ),
    ).toThrow(/cursor.*codex|codex.*cursor/u);
    expect(readFileSync(targetPath, "utf8")).toBe(before);

    symlinkSync("SKILL.md", join(root, ".codex/skills/example/linked.md"));
    expect(() => projectSkillArtifacts(root, manifestFor(sharedTargets()))).toThrow(/symlink/u);
    rmSync(join(root, ".codex/skills/example/linked.md"));

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor([
          { harness: "claude", path: ".claude/skills/example", overlays: [] },
          { harness: "codex", path: "../outside", overlays: [] },
        ]),
      ),
    ).toThrow(/escapes repo root|repo-relative/u);
  });

  it("prevalidates every target and header before any materialization", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "new canonical\n",
        ".codex/skills/example/SKILL.md": "old target\n",
        "scripts/tests/test-skill.sh": [
          "#!/usr/bin/env bash",
          SKILL_SMOKE_SUBJECTS_BEGIN,
          "# smoke-subjects: stale/path",
          SKILL_SMOKE_SUBJECTS_END,
          `${SKILL_SMOKE_SUBJECTS_END} malformed duplicate`,
          "# smoke-subjects: scripts/tests/test-skill.sh",
          "",
        ].join("\n"),
        ".gitignore": "",
      },
      "skill-projection-prevalidation-",
    );
    const targetBefore = readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8");
    const headerBefore = readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8");

    expect(() => projectSkillArtifacts(root, manifestFor(sharedTargets()))).toThrow(
      /generated skill smoke-subject marker/u,
    );
    expect(readFileSync(join(root, ".codex/skills/example/SKILL.md"), "utf8")).toBe(targetBefore);
    expect(readFileSync(join(root, "scripts/tests/test-skill.sh"), "utf8")).toBe(headerBefore);
  });

  it("rejects forbidden-side files and unmatched overlays", () => {
    const root = writeRepo(
      {
        ".claude/skills/example/SKILL.md": "same\n",
        ".claude/skills/example/agents/forbidden.yaml": "bad\n",
        ".codex/skills/example/SKILL.md": "same\n",
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      "skill-projection-forbidden-",
    );

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(sharedTargets([{ path: "agents", kind: "target-only" }])),
      ),
    ).toThrow(/forbidden in canonical/u);
    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(sharedTargets([{ path: "missing", kind: "canonical-only" }])),
      ),
    ).toThrow(/matches no skill file/u);
  });

  it.each([
    {
      canonical: ".claude/skills/example/SKILL.md",
      kind: "frontmatter-field",
      path: "EXTRA.md",
      targetContent: "---\nname: extra\ntarget-note: keep\n---\n\n# Extra\n",
      targetPath: ".codex/skills/example/EXTRA.md",
      field: "target-note",
    },
    {
      canonical: ".claude/skills/example/SKILL.md",
      kind: "harness-block",
      path: "GUIDE.md",
      targetContent:
        "shared\n<!-- BEGIN HARNESS-SPECIFIC: codex -->\ncodex\n<!-- END HARNESS-SPECIFIC -->\n",
      targetPath: ".codex/skills/example/GUIDE.md",
    },
  ])("rejects a $kind content overlay whose path exists only in the target", (fixture) => {
    const root = writeRepo(
      {
        [fixture.canonical]: "same\n",
        ".codex/skills/example/SKILL.md": "same\n",
        [fixture.targetPath]: fixture.targetContent,
        "scripts/tests/test-skill.sh":
          "#!/usr/bin/env bash\n# smoke-subjects: scripts/tests/test-skill.sh\n",
        ".gitignore": "",
      },
      `skill-projection-${fixture.kind}-target-only-path-`,
    );
    const targetBefore = readFileSync(join(root, fixture.targetPath), "utf8");

    expect(() =>
      projectSkillArtifacts(
        root,
        manifestFor(
          sharedTargets([
            {
              path: fixture.path,
              kind: fixture.kind,
              ...(fixture.field === undefined ? {} : { field: fixture.field }),
            },
          ]),
        ),
      ),
    ).toThrow(
      `${fixture.kind} content overlay names a path absent from canonical: ${fixture.path}`,
    );
    expect(readFileSync(join(root, fixture.targetPath), "utf8")).toBe(targetBefore);
  });
});
