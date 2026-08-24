import { describe, expect, it } from "vitest";

import { canonicalHookCommand, resolveHookWiring } from "./hook-wiring-schema.js";

const CLAUDE_EDIT = {
  matcher: "Edit|Write",
  command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/doc-length.sh",
};
const CODEX_EDIT = {
  matcher: "apply_patch",
  command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/doc-length.sh"',
  statusMessage: "Checking edited doc length",
  timeout: 15,
};
const COPILOT_EDIT = {
  matcher: "create|edit",
  command: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/doc-length.sh"',
  timeout: 15,
};

const OTHER_HARNESS_NOTES = {
  codex: "Codex routes this policy through its Bash aggregator.",
  copilot: "Copilot routes this policy through its Bash aggregator.",
};

function editWiring(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "PostToolUse",
    body: "scripts/ai-hooks/doc-length.sh",
    order: 20,
    surface: "edit",
    harnesses: { claude: CLAUDE_EDIT, codex: CODEX_EDIT, copilot: COPILOT_EDIT },
    ...overrides,
  };
}

function claudeBashWiring(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "PreToolUse",
    body: "scripts/ai-hooks/no-direct-db.sh",
    order: 10,
    surface: "bash",
    harnesses: {
      claude: {
        matcher: "Bash",
        command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/no-direct-db.sh",
      },
    },
    notes: OTHER_HARNESS_NOTES,
    ...overrides,
  };
}

function copilotAggregator(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "PreToolUse",
    body: "scripts/ai-hooks/bash-pre-tool-use.sh",
    order: 10,
    harnesses: {
      copilot: {
        matcher: "bash|powershell",
        command: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/pre-tool-use.sh"',
        timeout: 60,
      },
    },
    notes: {
      claude: "Claude uses direct Bash PreToolUse adapters.",
      codex: "Codex runs the same shared aggregate body.",
      copilot: "Aggregator: one fixed shim name dispatches the shared aggregate body.",
    },
    ...overrides,
  };
}

describe("canonicalHookCommand", () => {
  it("projects the Claude CLAUDE_PROJECT_DIR template from the shared body basename", () => {
    expect(canonicalHookCommand("claude", "scripts/ai-hooks/doc-length.sh")).toBe(
      "bash $CLAUDE_PROJECT_DIR/.claude/hooks/doc-length.sh",
    );
  });

  it("projects the toplevel-quoted template into each adapter directory", () => {
    expect(canonicalHookCommand("codex", "scripts/ai-hooks/doc-length.sh")).toBe(
      'bash "$(git rev-parse --show-toplevel)/.codex/hooks/doc-length.sh"',
    );
    expect(canonicalHookCommand("copilot", "scripts/ai-hooks/doc-length.sh")).toBe(
      'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/doc-length.sh"',
    );
  });
});

describe("hookWiring surface declaration", () => {
  it("resolves a declared edit surface whose bindings match the canonical projection", () => {
    const wiring = resolveHookWiring("hook/fixture-edit", editWiring());

    expect(wiring.surface).toBe("edit");
    expect(wiring.harnesses.codex?.matcher).toBe("apply_patch");
  });

  it("resolves a declared bash surface on a PostToolUseFailure hook", () => {
    const wiring = resolveHookWiring(
      "hook/fixture-failure",
      claudeBashWiring({
        event: "PostToolUseFailure",
        body: "scripts/ai-hooks/failure-guidance.sh",
        harnesses: {
          claude: {
            matcher: "Bash",
            command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/failure-guidance.sh",
          },
        },
      }),
    );

    expect(wiring.surface).toBe("bash");
  });

  it("omits surface from the resolved model when it is not declared", () => {
    const wiring = resolveHookWiring(
      "hook/fixture-lifecycle",
      claudeBashWiring({
        surface: undefined,
        event: "SessionStart",
        body: "scripts/ai-hooks/session-state.sh",
        harnesses: {
          claude: {
            matcher: "startup|resume|compact",
            command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/session-state.sh",
          },
        },
      }),
    );

    expect(wiring.surface).toBeUndefined();
  });

  it("rejects a surface declaration on an event whose matcher is authored policy", () => {
    expect(() =>
      resolveHookWiring(
        "hook/fixture-lifecycle",
        claudeBashWiring({
          event: "SessionStart",
          body: "scripts/ai-hooks/session-state.sh",
          harnesses: {
            claude: {
              matcher: "Bash",
              command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/session-state.sh",
            },
          },
        }),
      ),
    ).toThrow(
      /hookWiring\.surface is not supported for SessionStart: only PreToolUse, PostToolUse, PostToolUseFailure matchers are adapter syntax/u,
    );
  });

  it("rejects a surface value outside the adapter vocabulary", () => {
    expect(() => resolveHookWiring("hook/fixture-edit", editWiring({ surface: "tool" }))).toThrow(
      /hookWiring\.surface must be one of: bash, edit/u,
    );
  });

  it("rejects a matcher that diverges from the canonical projection and prints the expectation", () => {
    expect(() =>
      resolveHookWiring(
        "hook/fixture-edit",
        editWiring({
          harnesses: {
            claude: { ...CLAUDE_EDIT, matcher: "Edit|Write|MultiEdit" },
            codex: CODEX_EDIT,
            copilot: COPILOT_EDIT,
          },
        }),
      ),
    ).toThrow(
      /harnesses\.claude\.matcher must be "Edit\|Write" for the declared edit surface; got "Edit\|Write\|MultiEdit"/u,
    );
  });

  it("rejects a command that diverges from the canonical projection and prints the expectation", () => {
    expect(() =>
      resolveHookWiring(
        "hook/fixture-edit",
        editWiring({
          harnesses: {
            claude: CLAUDE_EDIT,
            codex: {
              ...CODEX_EDIT,
              command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/docs-length.sh"',
            },
            copilot: COPILOT_EDIT,
          },
        }),
      ),
    ).toThrow(
      /harnesses\.codex\.command must be the canonical projection of hookWiring\.body: bash "\$\(git rev-parse --show-toplevel\)\/\.codex\/hooks\/doc-length\.sh"/u,
    );
  });

  it("fails closed on a harness/surface pair with no canonical adapter syntax", () => {
    expect(() =>
      resolveHookWiring(
        "hook/fixture-codex-bash",
        claudeBashWiring({
          notes: { claude: "Claude uses a direct Bash adapter.", copilot: "Aggregated." },
          harnesses: {
            codex: {
              matcher: "Bash",
              command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/no-direct-db.sh"',
              statusMessage: "Checking",
            },
          },
        }),
      ),
    ).toThrow(/no canonical bash adapter syntax exists for codex/u);
  });
});

describe("hookWiring surface tripwire", () => {
  it("demands a declaration when a tool-use binding already matches the canonical projection", () => {
    expect(() =>
      resolveHookWiring("hook/fixture-edit", editWiring({ surface: undefined })),
    ).toThrow(/hook\/fixture-edit\.hookWiring must declare surface: "edit"/u);
  });

  it("accepts a note on the diverging wired harness when the command is not the canonical projection", () => {
    expect(
      resolveHookWiring("hook/fixture-aggregator", copilotAggregator()).surface,
    ).toBeUndefined();
  });

  it("rejects a diverging wired binding whose notes only cover the omitted harnesses", () => {
    expect(() =>
      resolveHookWiring(
        "hook/fixture-aggregator",
        copilotAggregator({
          notes: {
            claude: "Claude uses direct Bash PreToolUse adapters.",
            codex: "Codex runs the same shared aggregate body.",
          },
        }),
      ),
    ).toThrow(
      /harnesses\.copilot uses the canonical bash matcher "bash\|powershell" but not the canonical command projection \(expected: bash "\$\(git rev-parse --show-toplevel\)\/\.copilot\/hooks\/bash-pre-tool-use\.sh"\); declare hookWiring\.surface, or explain this binding in hookWiring\.notes\.copilot/u,
    );
  });

  it("rejects a mistyped single-harness shim basename despite mandatory omission notes", () => {
    expect(() =>
      resolveHookWiring(
        "hook/fixture-typo",
        claudeBashWiring({
          body: "scripts/ai-hooks/foo.sh",
          harnesses: {
            claude: {
              matcher: "Bash",
              command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/fooo.sh",
            },
          },
          surface: undefined,
        }),
      ),
    ).toThrow(/hookWiring\.notes\.claude/u);
  });

  it("rejects an undeclared canonical matcher with neither a surface nor any note", () => {
    expect(() =>
      resolveHookWiring("hook/fixture-aggregator", {
        event: "PreToolUse",
        body: "scripts/ai-hooks/bash-pre-tool-use.sh",
        order: 10,
        harnesses: {
          claude: {
            matcher: "Bash",
            command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/pre-tool-use.sh",
          },
          codex: {
            matcher: "Bash",
            command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/pre-tool-use.sh"',
            statusMessage: "Checking",
          },
          copilot: {
            matcher: "bash|powershell",
            command: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/pre-tool-use.sh"',
          },
        },
      }),
    ).toThrow(
      /uses the canonical bash matcher .* declare hookWiring\.surface, .* hookWiring\.notes\.claude/u,
    );
  });

  it("leaves lifecycle and matcher-less events out of the tripwire", () => {
    expect(
      resolveHookWiring("hook/fixture-stop", {
        event: "Stop",
        body: "scripts/ai-hooks/stop-reminder.sh",
        order: 10,
        harnesses: {
          claude: { command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/stop-reminder.sh" },
        },
        notes: OTHER_HARNESS_NOTES,
      }).surface,
    ).toBeUndefined();
  });

  it("does not demand a declaration for a codex Bash aggregator matcher", () => {
    expect(
      resolveHookWiring("hook/fixture-codex-aggregator", {
        event: "PostToolUse",
        body: "scripts/ai-hooks/bash-post-tool-use.sh",
        order: 20,
        harnesses: {
          codex: {
            matcher: "Bash",
            command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/post-tool-use.sh"',
            statusMessage: "Running Bash post-tool checks",
            timeout: 60,
          },
        },
        notes: {
          claude: "Claude uses direct adapters.",
          copilot: "Copilot has its own aggregator control.",
        },
      }).surface,
    ).toBeUndefined();
  });
});

describe("hookWiring unknown-field rejection", () => {
  it("rejects an unknown top-level hookWiring field", () => {
    expect(() => resolveHookWiring("hook/fixture-edit", editWiring({ surfaces: "edit" }))).toThrow(
      /hookWiring\.surfaces is not a supported field; supported: body, event, harnesses, notes, order, outputs, surface/u,
    );
  });

  it("rejects an unknown harness command field", () => {
    expect(() =>
      resolveHookWiring(
        "hook/fixture-edit",
        editWiring({
          harnesses: {
            claude: { ...CLAUDE_EDIT, timeoutSeconds: 15 },
            codex: CODEX_EDIT,
            copilot: COPILOT_EDIT,
          },
        }),
      ),
    ).toThrow(
      /harnesses\.claude\.timeoutSeconds is not a supported field; supported: command, matcher, statusMessage, timeout/u,
    );
  });

  it("accepts every currently authored top-level field", () => {
    const wiring = resolveHookWiring(
      "hook/fixture-edit",
      editWiring({
        outputs: ["additionalContext"],
        notes: { claude: "Claude also reports through additionalContext." },
      }),
    );

    expect(wiring.outputs).toStrictEqual(["additionalContext"]);
    expect(wiring.notes?.claude).toBe("Claude also reports through additionalContext.");
  });
});
