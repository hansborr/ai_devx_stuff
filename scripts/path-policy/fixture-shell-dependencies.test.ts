import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateFixtureShellDependencies } from "./fixture-shell-dependencies.js";

describe("monitored fixture shell dependencies", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "fixture-shell-dependencies-"));
    mkdirSync(join(repoRoot, "scripts", "tests"), { recursive: true });
    mkdirSync(join(repoRoot, "scripts", "lib"), { recursive: true });
    mkdirSync(join(repoRoot, "scripts", "verify"), { recursive: true });
    writeFileSync(
      join(repoRoot, "scripts", "verify", "memory-budget.sh"),
      [
        "#!/usr/bin/env bash",
        "# shellcheck source=../lib/test-worker-count.sh",
        '. "$(dirname "${BASH_SOURCE[0]}")/../lib/test-worker-count.sh"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(repoRoot, "scripts", "lib", "test-worker-count.sh"), "#!/bin/bash\n");
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeSmoke(lines: readonly string[]): void {
    writeFileSync(
      join(repoRoot, "scripts", "tests", "test-fixture.sh"),
      ["#!/usr/bin/env bash", ...lines, ""].join("\n"),
    );
  }

  it("rejects an admission fixture that omits a literal sourced dependency", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("rejects copied fixture support that is absent from smoke-subject metadata", () => {
    writeFileSync(join(repoRoot, "scripts", "lib", "gate-env.sh"), "#!/bin/bash\n");
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      'cp "$SCRIPT_DIR/../lib/gate-env.sh" "$repo/scripts/lib/gate-env.sh"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh copies scripts/lib/gate-env.sh but its smoke-subject headers omit that path",
    );
  });

  it("rejects a copied TS module that is absent from smoke-subject metadata", () => {
    // The changed-mode false PASS this whole check exists to prevent: a smoke
    // copies and executes a TS module, but nothing names it as a subject, so
    // editing that module never selects the smoke.
    writeFileSync(join(repoRoot, "scripts", "lib", "doc-generator.ts"), "export const gen = 1;\n");
    writeSmoke([
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp scripts/lib/doc-generator.ts "$repo/scripts/lib/doc-generator.ts"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh copies scripts/lib/doc-generator.ts but its smoke-subject headers omit that path",
    );
  });

  it("rejects copied non-script data that is absent from smoke-subject metadata", () => {
    // Copied data is a smoke input exactly like copied code: the sandbox runs
    // against it, so a change to it must select the smoke.
    mkdirSync(join(repoRoot, "eslint-config"), { recursive: true });
    writeFileSync(join(repoRoot, "eslint-config", "baseline.json"), "{}\n");
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      'cp eslint-config/baseline.json "$repo/eslint-config/baseline.json"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh copies eslint-config/baseline.json but its smoke-subject headers omit that path",
    );
  });

  it("rejects a recursively copied directory that is absent from smoke-subject metadata", () => {
    mkdirSync(join(repoRoot, "eslint-config"), { recursive: true });
    writeFileSync(join(repoRoot, "eslint-config", "baseline.json"), "{}\n");
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      'cp -R eslint-config/. "$repo/eslint-config/"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh copies eslint-config/ but its smoke-subject headers omit that path",
    );
  });

  it("accepts copied paths covered by a directory-prefix smoke subject", () => {
    // `matchesSmokeSubject` in path-policy-query-core treats a trailing-slash
    // subject as a prefix; the metadata check must read subjects the same way
    // or it would demand a per-file subject the selector does not need.
    mkdirSync(join(repoRoot, "eslint-config"), { recursive: true });
    writeFileSync(join(repoRoot, "eslint-config", "baseline.json"), "{}\n");
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "# smoke-subjects: eslint-config/",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      'cp eslint-config/baseline.json "$repo/eslint-config/baseline.json"',
      'cp -R eslint-config/. "$repo/eslint-config/"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).not.toThrow();
  });

  it("rejects an under-closed second sandbox even when the first sandbox is complete", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo_one/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo_one/scripts/lib/test-worker-count.sh"',
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo_two/scripts/verify/memory-budget.sh"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh fixture $repo_two copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("does not merge the same destination variable across fixture functions", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "copy_complete_fixture() {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      '  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "}",
      "copy_incomplete_fixture() {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      "}",
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh function copy_incomplete_fixture fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("keeps function scope across a brace-group guard closed by a lone brace", () => {
    // `|| { ... }` guard blocks closed by a bare `}` are common in real smokes
    // (expect_reject helpers); the closer must not pop the enclosing function
    // scope, or copies after the guard land in the wrong fixture group.
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "copy_guarded_fixture() {",
      "  command -v git >/dev/null || {",
      '    echo "skipping"',
      "    exit 0",
      "  }",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      "}",
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh function copy_guarded_fixture fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("recognizes function-keyword fixture declarations", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "function copy_complete_fixture {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      '  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "}",
      "function copy_incomplete_fixture {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      "}",
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh function copy_incomplete_fixture fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("keeps identical nested function names in their full lexical scopes", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "copy_complete_outer() {",
      "  copy_nested() {",
      '    cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      '    cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "  }",
      "}",
      "copy_incomplete_outer() {",
      "  copy_nested() {",
      '    cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      "  }",
      "}",
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh function copy_incomplete_outer > copy_nested fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("follows a copy-helper call site into the caller's fixture group", () => {
    // The helper copies the sourced dependency; the caller copies the root
    // script and hands the fixture root to the helper. The composed group is
    // closed, so no failure fires despite the scope split.
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "install_support() {",
      '  local repo="$1"',
      '  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "}",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$WRAPPER_REPO/scripts/verify/memory-budget.sh"',
      'install_support "$WRAPPER_REPO"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).not.toThrow();
  });

  it("follows a delegate-only wrapper helper into the caller's fixture group", () => {
    // wrapper only forwards to copy_leaf and copies nothing itself, so no
    // group exists under wrapper before propagation. Transitive composition
    // must still deliver the leaf's copied dependency to the caller's group.
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "copy_leaf() {",
      '  local repo="$1"',
      '  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "}",
      "wrapper() {",
      '  local repo="$1"',
      '  copy_leaf "$repo"',
      "}",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$WRAPPER_REPO/scripts/verify/memory-budget.sh"',
      'wrapper "$WRAPPER_REPO"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).not.toThrow();
  });

  it("follows a constructor helper that prints the fixture root it seeded", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "make_repo() {",
      '  local repo="$TMP_ROOT/$1"',
      '  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      '  printf "%s\\n" "$repo"',
      "}",
      "repo=$(make_repo default)",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).not.toThrow();
  });

  it("validates copy sets outside the memory-admission family (B5 generalization)", () => {
    // No admission script anywhere: a plain wrapper with a sourced lib must
    // still close its sandbox copy set.
    writeFileSync(
      join(repoRoot, "scripts", "custom-wrapper.sh"),
      [
        "#!/usr/bin/env bash",
        "# shellcheck source=lib/custom-lib.sh",
        '. "$(dirname "${BASH_SOURCE[0]}")/lib/custom-lib.sh"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(repoRoot, "scripts", "lib", "custom-lib.sh"), "#!/bin/bash\n");
    writeSmoke([
      "# smoke-subjects: scripts/custom-wrapper.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../custom-wrapper.sh" "$repo/scripts/custom-wrapper.sh"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh fixture $repo copies scripts/custom-wrapper.sh but omits sourced dependency scripts/lib/custom-lib.sh",
    );
  });

  it("accepts a transitively closed admission fixture with complete smoke metadata", () => {
    writeFileSync(
      join(repoRoot, "scripts", "lib", "tool-memory-admission.sh"),
      [
        "#!/usr/bin/env bash",
        "# shellcheck source=../verify/memory-budget.sh",
        "# shellcheck source=../process-tree.sh",
        "",
      ].join("\n"),
    );
    writeFileSync(join(repoRoot, "scripts", "process-tree.sh"), "#!/bin/bash\n");
    writeSmoke([
      "# smoke-subjects: scripts/lib/tool-memory-admission.sh",
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/process-tree.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'TOOL_MEMORY="$SCRIPT_DIR/../lib/tool-memory-admission.sh"',
      'cp "$TOOL_MEMORY" "$repo/scripts/lib/tool-memory-admission.sh"',
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      'cp "$SCRIPT_DIR/../process-tree.sh" "$repo/scripts/process-tree.sh"',
    ]);

    expect(() => {
      validateFixtureShellDependencies(repoRoot);
    }).not.toThrow();
  });

  describe("copied TS/JS entry import closures", () => {
    function writeScript(relativePath: string, ...lines: readonly string[]): void {
      const path = join(repoRoot, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, [...lines, ""].join("\n"));
    }

    // Subject coverage is exercised by its own cases above; these smokes
    // declare broad directory subjects so each assertion isolates closure
    // behaviour instead of re-reporting metadata gaps.
    function writeClosureSmoke(lines: readonly string[]): void {
      writeSmoke([
        "# smoke-subjects: scripts/tests/test-fixture.sh",
        "# smoke-subjects: scripts/",
        "# smoke-subjects: packages/",
        ...lines,
      ]);
    }

    beforeEach(() => {
      writeScript("scripts/tool.ts", 'import "./tool-lib.js";');
      writeScript("scripts/tool-lib.ts", "export const toolLib = 1;");
    });

    it("rejects a fixture that copies a TS entry but omits an imported module", () => {
      writeClosureSmoke(['cp scripts/tool.ts "$repo/scripts/tool.ts"']);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture $repo copies scripts/tool.ts but omits imported dependency scripts/tool-lib.ts",
      );
    });

    it("accepts a fixture that copies the whole import closure", () => {
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("treats a heredoc-synthesized stub as satisfying the import and stops walking there", () => {
      writeScript("scripts/tool-lib.ts", 'import "./tool-lib-deep.js";');
      writeScript("scripts/tool-lib-deep.ts", "export const deep = 1;");
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        `cat >"$repo/scripts/tool-lib.ts" <<'TS'`,
        "export const toolLib = 1;",
        "TS",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("treats a scoped node_modules symlink as an external package", () => {
      writeScript("scripts/tool.ts", 'import "@musi/lint-ratchet/kernel/gate.js";');
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'ln -s "$PWD/tools/lint-ratchet" "$repo/node_modules/@musi/lint-ratchet"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("reports an unresolvable repository-local package import as a copy-set failure", () => {
      writeScript("scripts/tool.ts", 'import "@musi/lint-ratchet/kernel/gate.js";');
      writeClosureSmoke(['cp scripts/tool.ts "$repo/scripts/tool.ts"']);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture $repo cannot walk the import closure of scripts/tool.ts",
      );
    });

    it("treats a whole node_modules symlink as resolving every repository-local package", () => {
      writeScript("scripts/tool.ts", 'import "@musi/shared/schemas/thing.js";');
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'ln -s "$REPO_ROOT/node_modules" "$repo/node_modules"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("skips a fixture root seeded by a whole-tree clone", () => {
      writeClosureSmoke([
        'git clone -q --shared "$REPO_ROOT" "$repo"',
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("treats a copied directory as satisfying every closure file beneath it", () => {
      writeScript("scripts/tool.ts", 'import "./support/lib.js";');
      writeScript("scripts/support/lib.ts", "export const lib = 1;");
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp -R scripts/support/. "$repo/scripts/support/"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("attributes copies landing outside the fixture's scripts subtree to the same sandbox", () => {
      writeScript("scripts/tool.ts", 'import "../packages/shared/src/thing.js";');
      writeScript("packages/shared/src/thing.ts", "export const thing = 1;");
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp packages/shared/src/thing.ts "$repo/packages/shared/src/thing.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("merges sandbox contributions from sibling helpers composed at one call site", () => {
      // Composition is what licenses the merge: the caller hands the same root
      // to both helpers, so their contributions belong to one sandbox.
      writeClosureSmoke([
        "copy_entry() {",
        '  local repo="$1"',
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        "}",
        "copy_support() {",
        '  local repo="$1"',
        '  cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
        "}",
        "build() {",
        '  copy_entry "$SANDBOX"',
        '  copy_support "$SANDBOX"',
        "}",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("reports a copy whose source expression the model cannot resolve", () => {
      // The silent-suppression case: a dynamic source used to vanish, taking
      // the whole fixture with it. It must be visible, not skipped.
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
        'cp "$runtime_file" "$repo/scripts/"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        'scripts/tests/test-fixture.sh fixture $repo seeds from "$runtime_file", which this model cannot resolve',
      );
    });

    it("accepts an unresolvable copy the unmodelled-copy annotation acknowledges", () => {
      writeClosureSmoke([
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
        "# fixture-closure: unmodelled-copy - the list comes from git ls-files",
        'cp "$runtime_file" "$repo/scripts/"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("rejects an unmodelled-copy annotation whose sources all resolve", () => {
      writeClosureSmoke([
        "# fixture-closure: unmodelled-copy - stale acknowledgement",
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture-closure annotation 'unmodelled-copy' governs a cp whose sources all resolve",
      );
    });

    it("resolves copies made through a literal loop variable", () => {
      writeClosureSmoke([
        "for tool in scripts/tool.ts; do",
        '  cp "$tool" "$repo/scripts/"',
        "done",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture $repo copies scripts/tool.ts but omits imported dependency scripts/tool-lib.ts",
      );
    });

    it("expands a literal glob in a copy operand", () => {
      writeScript("scripts/globbed/entry.ts", 'import "../globbed-leaf.js";');
      writeScript("scripts/globbed-leaf.ts", "export const leaf = 1;");
      writeClosureSmoke([
        'cp scripts/globbed/*.t? "$repo_glob/scripts/globbed/"',
        'cp scripts/tool.ts scripts/tool-lib.ts "$repo/scripts/"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture $repo_glob copies scripts/globbed/entry.ts but omits imported dependency scripts/globbed-leaf.ts",
      );
    });

    it("keeps loop-variable bindings inside the function that established them", () => {
      // `runtime_file` is a different list in each helper in the live tree;
      // leaking one binding into the other would attribute one fixture's copy
      // set to another.
      writeClosureSmoke([
        "seed_one() {",
        "  for tool in scripts/tool.ts scripts/tool-lib.ts; do",
        '    cp "$tool" "$repo_one/scripts/"',
        "  done",
        "}",
        "seed_two() {",
        '  cp "$tool" "$repo_two/scripts/"',
        "}",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        'scripts/tests/test-fixture.sh fixture $repo_two seeds from "$tool", which this model cannot resolve',
      );
    });

    it("discovers a sandbox root that only mkdir establishes", () => {
      // The densest live sandboxes create their scripts/ tree with mkdir and
      // fill it through loops, so a root found only from literal cp
      // destinations left them entirely invisible.
      writeClosureSmoke([
        'mkdir -p "$sandbox/scripts"',
        'cp scripts/tool.ts "$sandbox/overlay/tool.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture $sandbox copies scripts/tool.ts but omits imported dependency scripts/tool-lib.ts",
      );
    });

    it("treats modules inside a copied scripts directory as entries of their own", () => {
      writeScript("scripts/support/lib.ts", 'import "../outside.js";');
      writeScript("scripts/outside.ts", "export const outside = 1;");
      writeClosureSmoke([
        'cp scripts/tool.ts scripts/tool-lib.ts "$repo/scripts/"',
        'cp -R scripts/support/. "$repo/scripts/support/"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture $repo copies scripts/support/lib.ts but omits imported dependency scripts/outside.ts",
      );
    });

    it("ignores a copy whose source is inside the sandbox itself", () => {
      writeClosureSmoke([
        'cp scripts/tool.ts scripts/tool-lib.ts "$repo/scripts/"',
        'cp "$repo/scripts/tool.ts" "$repo/scripts/tool-backup.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("exempts a copied module the not-an-entry annotation declares is never executed", () => {
      writeClosureSmoke([
        "# fixture-closure: not-an-entry - the sandbox only asserts that running it fails",
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).not.toThrow();
    });

    it("rejects a not-an-entry annotation that governs no scripts/** entry", () => {
      writeScript("packages/shared/src/thing.ts", "export const thing = 1;");
      writeClosureSmoke([
        "# fixture-closure: not-an-entry - stale marker left behind by an edit",
        'cp packages/shared/src/thing.ts "$repo/packages/shared/src/thing.ts"',
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture-closure annotation 'not-an-entry' governs a cp that copies no scripts/** entry",
      );
    });

    it("rejects a not-an-entry annotation that governs no fixture cp at all", () => {
      writeClosureSmoke([
        "# fixture-closure: not-an-entry - marker stranded above a non-copy statement",
        'echo "not a copy"',
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh fixture-closure annotation 'not-an-entry' governs no fixture cp command",
      );
    });

    it("rejects an unknown fixture-closure annotation kind", () => {
      writeClosureSmoke([
        "# fixture-closure: ignore-everything - not a supported kind",
        'cp scripts/tool.ts "$repo/scripts/tool.ts"',
        'cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh unknown fixture-closure annotation kind 'ignore-everything'",
      );
    });

    it("does not let an unrelated function's copies satisfy a same-named fixture root", () => {
      // The isolation counterexample for the merge above: two fixtures reuse
      // the token `$repo` with no composition between them, so the complete
      // one must not close the incomplete one.
      writeClosureSmoke([
        "seed_complete_fixture() {",
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        '  cp scripts/tool-lib.ts "$repo/scripts/tool-lib.ts"',
        "}",
        "seed_incomplete_fixture() {",
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        "}",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh function seed_incomplete_fixture fixture $repo copies scripts/tool.ts but omits imported dependency scripts/tool-lib.ts",
      );
    });

    it("does not let one function's whole-tree clone disable checking for a same-named root", () => {
      writeClosureSmoke([
        "seed_cloned_fixture() {",
        '  git clone -q --shared "$REPO_ROOT" "$repo"',
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        "}",
        "seed_incomplete_fixture() {",
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        "}",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh function seed_incomplete_fixture fixture $repo copies scripts/tool.ts but omits imported dependency scripts/tool-lib.ts",
      );
    });

    it("does not let one function's package symlink resolve a same-named root's import", () => {
      writeScript("scripts/tool.ts", 'import "@musi/lint-ratchet/kernel/gate.js";');
      writeClosureSmoke([
        "seed_linked_fixture() {",
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        '  ln -s "$PWD/tools/lint-ratchet" "$repo/node_modules/@musi/lint-ratchet"',
        "}",
        "seed_unlinked_fixture() {",
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        "}",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh function seed_unlinked_fixture fixture $repo cannot walk the import closure of scripts/tool.ts",
      );
    });

    it("does not let one function's heredoc stub satisfy a same-named root's import", () => {
      writeClosureSmoke([
        "seed_stubbed_fixture() {",
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        `  cat >"$repo/scripts/tool-lib.ts" <<'TS'`,
        "export const toolLib = 1;",
        "TS",
        "}",
        "seed_incomplete_fixture() {",
        '  cp scripts/tool.ts "$repo/scripts/tool.ts"',
        "}",
      ]);

      expect(() => {
        validateFixtureShellDependencies(repoRoot);
      }).toThrow(
        "scripts/tests/test-fixture.sh function seed_incomplete_fixture fixture $repo copies scripts/tool.ts but omits imported dependency scripts/tool-lib.ts",
      );
    });
  });
});
