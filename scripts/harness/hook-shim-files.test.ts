import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkHookShimsOnDisk, writeHookShims } from "./hook-shim-files.js";
import type { RenderedShim } from "./hook-shims.js";

const SHIM: RenderedShim = {
  harness: "claude",
  relPath: ".claude/hooks/fixture.sh",
  content: '#!/bin/bash\nexec bash "$REPO_ROOT/scripts/ai-hooks/fixture.sh"\n',
};

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "musi-hook-shim-files-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("writeHookShims", () => {
  it("writes shim bytes with the executable bit into a bare root", () => {
    writeHookShims([SHIM], tempRoot);

    const path = join(tempRoot, SHIM.relPath);
    expect(readFileSync(path, "utf8")).toBe(SHIM.content);
    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([]);
  });

  it("prunes orphan *.sh files a removed manifest entry left behind", () => {
    mkdirSync(join(tempRoot, ".codex/hooks"), { recursive: true });
    writeFileSync(join(tempRoot, ".codex/hooks/orphan.sh"), "#!/bin/bash\n");

    writeHookShims([SHIM], tempRoot);

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([]);
  });

  it("prunes orphan symlinks too", () => {
    writeHookShims([SHIM], tempRoot);
    symlinkSync("fixture.sh", join(tempRoot, ".claude/hooks/orphan-link.sh"));

    writeHookShims([SHIM], tempRoot);

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([]);
  });

  it("repairs executable-bit and content drift on rewrite", () => {
    writeHookShims([SHIM], tempRoot);
    const path = join(tempRoot, SHIM.relPath);
    chmodSync(path, 0o644);
    writeFileSync(path, "#!/bin/bash\nhand edit\n");

    writeHookShims([SHIM], tempRoot);

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([]);
  });
});

describe("checkHookShimsOnDisk", () => {
  it("reports a missing shim", () => {
    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([".claude/hooks/fixture.sh (missing)"]);
  });

  it("reports content drift after a hand edit", () => {
    writeHookShims([SHIM], tempRoot);
    writeFileSync(join(tempRoot, SHIM.relPath), `${SHIM.content}# hand edit\n`);

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([
      ".claude/hooks/fixture.sh (content drift)",
    ]);
  });

  it("reports a missing executable bit", () => {
    writeHookShims([SHIM], tempRoot);
    chmodSync(join(tempRoot, SHIM.relPath), 0o644);

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([
      ".claude/hooks/fixture.sh (missing executable bit)",
    ]);
  });

  it("rejects a symlink where a shim should be", () => {
    mkdirSync(join(tempRoot, ".claude/hooks"), { recursive: true });
    writeFileSync(join(tempRoot, ".claude/hooks/real.sh"), SHIM.content);
    symlinkSync("real.sh", join(tempRoot, SHIM.relPath));

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([
      ".claude/hooks/fixture.sh (must be a regular file, found a symlink)",
      ".claude/hooks/real.sh (orphan: no hookWiring entry derives it)",
    ]);
  });

  it("reports orphan *.sh files across the owned adapter directories", () => {
    writeHookShims([SHIM], tempRoot);
    mkdirSync(join(tempRoot, ".copilot/hooks"), { recursive: true });
    writeFileSync(join(tempRoot, ".copilot/hooks/stray.sh"), "#!/bin/bash\n");

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([
      ".copilot/hooks/stray.sh (orphan: no hookWiring entry derives it)",
    ]);
  });

  it("reports a stray directory named *.sh instead of silently passing over it", () => {
    writeHookShims([SHIM], tempRoot);
    mkdirSync(join(tempRoot, ".claude/hooks/stray.sh"));

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([
      ".claude/hooks/stray.sh (a *.sh entry must be a regular file, found a non-file entry; remove it by hand)",
    ]);
  });
});

describe("symlinked owned adapter directories", () => {
  const SYMLINK_DIR_PROBLEM =
    ".claude/hooks (owned shim path must be a real directory, found a symlink; refusing to touch files outside the owned tree)";

  function makeExternalTarget(): string {
    const external = join(tempRoot, "external-target");
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, "victim.sh"), "#!/bin/bash\nexternal file\n");
    return external;
  }

  it("write mode refuses a symlinked adapter dir and never touches the target", () => {
    const external = makeExternalTarget();
    mkdirSync(join(tempRoot, ".claude"), { recursive: true });
    symlinkSync(external, join(tempRoot, ".claude/hooks"));

    expect(() => {
      writeHookShims([SHIM], tempRoot);
    }).toThrow(/found a symlink.*harness:wiring/su);
    expect(readFileSync(join(external, "victim.sh"), "utf8")).toBe("#!/bin/bash\nexternal file\n");
    expect(existsSync(join(external, "fixture.sh"))).toBe(false);
  });

  it("check mode fails closed instead of validating content through the symlink", () => {
    const external = makeExternalTarget();
    // Byte-identical executable shim at the symlink target: without the
    // guard, --check would pass against this external content.
    writeFileSync(join(external, "fixture.sh"), SHIM.content);
    chmodSync(join(external, "fixture.sh"), 0o755);
    rmSync(join(external, "victim.sh"));
    mkdirSync(join(tempRoot, ".claude"), { recursive: true });
    symlinkSync(external, join(tempRoot, ".claude/hooks"));

    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([SYMLINK_DIR_PROBLEM]);
  });

  it("guards the adapter parent directory (.claude itself a symlink) too", () => {
    const external = join(tempRoot, "external-parent");
    mkdirSync(join(external, "hooks"), { recursive: true });
    symlinkSync(external, join(tempRoot, ".claude"));

    expect(() => {
      writeHookShims([SHIM], tempRoot);
    }).toThrow(/\.claude \(owned shim path must be a real directory, found a symlink/u);
    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([
      ".claude (owned shim path must be a real directory, found a symlink; refusing to touch files outside the owned tree)",
    ]);
  });

  it("rejects an owned adapter path that is a regular file", () => {
    mkdirSync(join(tempRoot, ".claude"), { recursive: true });
    writeFileSync(join(tempRoot, ".claude/hooks"), "not a directory\n");

    expect(() => {
      writeHookShims([SHIM], tempRoot);
    }).toThrow(/\.claude\/hooks \(owned shim path must be a directory\)/u);
    expect(checkHookShimsOnDisk([SHIM], tempRoot)).toEqual([
      ".claude/hooks (owned shim path must be a directory)",
    ]);
  });
});
