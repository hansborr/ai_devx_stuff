import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  renderHookWiringOutputsFromManifest,
  replaceClaudeHooksInSettings,
  writeHookWiringOutputs,
} from "./generate-hook-wiring.js";

const BASE_SETTINGS = `{
  "env": {
    "KEEP": "yes"
  },
  "permissions": {
    "deny": []
  },
  "hooks": {
    "PreToolUse": []
  },
  "enabledPlugins": {
    "typescript-lsp@claude-plugins-official": true
  }
}
`;

describe("hook wiring generator", () => {
  it("writes every output into a bare repo root with no pre-created directories", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "musi-hook-wiring-"));
    try {
      const manifest = {
        controls: [
          {
            id: "hook/shim-fixture",
            kind: "hook",
            hookWiring: {
              event: "PostToolUse",
              body: "scripts/ai-hooks/fixture.sh",
              order: 10,
              harnesses: {
                claude: {
                  matcher: "Edit|Write",
                  command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/fixture.sh",
                },
              },
              notes: { codex: "Fixture only.", copilot: "Fixture only." },
            },
          },
        ],
      };
      const outputs = renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS);
      const paths = {
        claudeSettingsPath: join(tempRoot, ".claude/settings.json"),
        codexHooksPath: join(tempRoot, ".codex/hooks.json"),
        copilotHooksPath: join(tempRoot, ".github/hooks/copilot.json"),
        shimRootPath: tempRoot,
      };

      writeHookWiringOutputs(outputs, paths);

      expect(readFileSync(paths.claudeSettingsPath, "utf8")).toBe(outputs.claudeSettingsJson);
      expect(readFileSync(paths.codexHooksPath, "utf8")).toBe(outputs.codexHooksJson);
      expect(readFileSync(paths.copilotHooksPath, "utf8")).toBe(outputs.copilotHooksJson);
      const shimPath = join(tempRoot, ".claude/hooks/fixture.sh");
      expect(readFileSync(shimPath, "utf8")).toBe(outputs.shims[0]?.content);
      // The atomic writer does not set modes; shim emission must chmod.
      expect(statSync(shimPath).mode & 0o111).not.toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("renders Claude, Codex, and Copilot hook wiring from manifest order metadata", () => {
    const manifest = {
      controls: [
        {
          id: "hook/codex-aggregator",
          kind: "hook",
          hookWiring: {
            event: "PostToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 90,
            harnesses: {
              codex: {
                matcher: "Bash",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/post-tool-use.sh"',
                statusMessage: "Summarizing repository Bash output",
                timeout: 60,
              },
            },
            notes: {
              claude: "Claude has no Codex Bash aggregation hook.",
              copilot: "Copilot has its own Bash aggregation hook.",
            },
          },
        },
        {
          id: "hook/prisma",
          kind: "hook",
          hookWiring: {
            event: "PostToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                matcher: "Edit|Write",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/prisma-generate.sh",
                timeout: 120,
              },
              codex: {
                matcher: "apply_patch",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/prisma-generate.sh"',
                statusMessage: "Regenerating Prisma client",
                timeout: 120,
              },
              copilot: {
                matcher: "create|edit",
                command:
                  'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/prisma-generate.sh"',
                timeout: 120,
              },
            },
          },
        },
        {
          id: "hook/doc-length",
          kind: "hook",
          hookWiring: {
            event: "PostToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 20,
            harnesses: {
              claude: {
                matcher: "Edit|Write",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/doc-length.sh",
              },
              codex: {
                matcher: "apply_patch",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/doc-length.sh"',
                statusMessage: "Checking edited doc length",
                timeout: 15,
              },
              copilot: {
                matcher: "create|edit",
                command: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/doc-length.sh"',
              },
            },
          },
        },
        {
          id: "hook/stop",
          kind: "hook",
          hookWiring: {
            event: "Stop",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            outputs: ["systemMessage"],
            harnesses: {
              claude: {
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/stop-reminder.sh",
                timeout: 30,
              },
            },
            notes: {
              codex: "Codex Stop has no verified user-only output channel.",
              copilot: "Copilot agentStop has no verified user-only output channel.",
            },
          },
        },
      ],
    };

    const outputs = renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS);
    const claudeSettings: unknown = JSON.parse(outputs.claudeSettingsJson);
    const codexHooks: unknown = JSON.parse(outputs.codexHooksJson);
    const copilotHooks: unknown = JSON.parse(outputs.copilotHooksJson);

    expect(claudeSettings).toMatchObject({
      env: { KEEP: "yes" },
      permissions: { deny: [] },
      enabledPlugins: { "typescript-lsp@claude-plugins-official": true },
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              {
                type: "command",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/prisma-generate.sh",
                timeout: 120,
              },
              {
                type: "command",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/doc-length.sh",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/stop-reminder.sh",
                timeout: 30,
              },
            ],
          },
        ],
      },
    });
    expect(codexHooks).toEqual({
      hooks: {
        PostToolUse: [
          {
            matcher: "apply_patch",
            hooks: [
              {
                type: "command",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/prisma-generate.sh"',
                statusMessage: "Regenerating Prisma client",
                timeout: 120,
              },
              {
                type: "command",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/doc-length.sh"',
                statusMessage: "Checking edited doc length",
                timeout: 15,
              },
            ],
          },
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/post-tool-use.sh"',
                statusMessage: "Summarizing repository Bash output",
                timeout: 60,
              },
            ],
          },
        ],
      },
    });
    expect(copilotHooks).toEqual({
      version: 1,
      hooks: {
        postToolUse: [
          {
            type: "command",
            matcher: "create|edit",
            bash: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/prisma-generate.sh"',
            timeoutSec: 120,
          },
          {
            type: "command",
            matcher: "create|edit",
            bash: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/doc-length.sh"',
          },
        ],
      },
    });
  });

  it("rejects status messages on Copilot hook commands", () => {
    const manifest = {
      controls: [
        {
          id: "hook/copilot-status",
          kind: "hook",
          hookWiring: {
            event: "PreToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              copilot: {
                matcher: "bash",
                command: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/pre-tool-use.sh"',
                statusMessage: "Checking Copilot Bash input",
              },
            },
            notes: {
              claude: "Fixture only.",
              codex: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "statusMessage is invalid",
    );
  });

  it("requires matchers on Copilot tool-use hook commands", () => {
    const manifest = {
      controls: [
        {
          id: "hook/copilot-no-matcher",
          kind: "hook",
          hookWiring: {
            event: "PreToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              copilot: {
                command: 'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/pre-tool-use.sh"',
              },
            },
            notes: {
              claude: "Fixture only.",
              codex: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "matcher is required for PreToolUse",
    );
  });

  it("renders lifecycle events with event-specific matcher policy", () => {
    const manifest = {
      controls: [
        {
          id: "hook/post-compact",
          kind: "hook",
          hookWiring: {
            event: "PostCompact",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/session-state.sh",
                timeout: 15,
              },
              codex: {
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/session-state.sh"',
                statusMessage: "Refreshing repository session state",
                timeout: 15,
              },
            },
            notes: {
              copilot: "Copilot has no PostCompact hook event.",
            },
          },
        },
        {
          id: "hook/subagent-start",
          kind: "hook",
          hookWiring: {
            event: "SubagentStart",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                matcher: "Explore|Plan",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/subagent-start.sh",
                timeout: 30,
              },
              codex: {
                matcher: "Explore|Plan",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/subagent-start.sh"',
                statusMessage: "Checking subagent start conditions",
                timeout: 30,
              },
            },
            notes: {
              copilot: "Copilot has no SubagentStart hook event.",
            },
          },
        },
        {
          id: "hook/failure-guidance",
          kind: "hook",
          hookWiring: {
            event: "PostToolUseFailure",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                matcher: "Bash",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/failure-guidance.sh",
              },
            },
            notes: {
              codex: "Codex does not support PostToolUseFailure hooks.",
              copilot: "Copilot has no PostToolUseFailure hook event.",
            },
          },
        },
        {
          id: "hook/user-prompt-submit",
          kind: "hook",
          hookWiring: {
            event: "UserPromptSubmit",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/prompt-context.sh",
              },
              codex: {
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/prompt-context.sh"',
                statusMessage: "Checking submitted prompt",
              },
            },
            notes: {
              copilot: "Copilot has no UserPromptSubmit hook event.",
            },
          },
        },
      ],
    };

    const outputs = renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS);
    const claudeSettings: unknown = JSON.parse(outputs.claudeSettingsJson);
    const codexHooks: unknown = JSON.parse(outputs.codexHooksJson);
    const copilotHooks: unknown = JSON.parse(outputs.copilotHooksJson);

    expect(claudeSettings).toMatchObject({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/prompt-context.sh",
              },
            ],
          },
        ],
        PostToolUseFailure: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/failure-guidance.sh",
              },
            ],
          },
        ],
        SubagentStart: [
          {
            matcher: "Explore|Plan",
            hooks: [
              {
                type: "command",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/subagent-start.sh",
                timeout: 30,
              },
            ],
          },
        ],
        PostCompact: [
          {
            hooks: [
              {
                type: "command",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/session-state.sh",
                timeout: 15,
              },
            ],
          },
        ],
      },
    });
    expect(codexHooks).toEqual({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/prompt-context.sh"',
                statusMessage: "Checking submitted prompt",
              },
            ],
          },
        ],
        SubagentStart: [
          {
            matcher: "Explore|Plan",
            hooks: [
              {
                type: "command",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/subagent-start.sh"',
                statusMessage: "Checking subagent start conditions",
                timeout: 30,
              },
            ],
          },
        ],
        PostCompact: [
          {
            hooks: [
              {
                type: "command",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/session-state.sh"',
                statusMessage: "Refreshing repository session state",
                timeout: 15,
              },
            ],
          },
        ],
      },
    });
    expect(copilotHooks).toEqual({
      version: 1,
      hooks: {},
    });
  });

  it("rejects matchers on events that do not support them", () => {
    const manifest = {
      controls: [
        {
          id: "hook/prompt-matcher",
          kind: "hook",
          hookWiring: {
            event: "UserPromptSubmit",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                matcher: "Bash",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/prompt-context.sh",
              },
            },
            notes: {
              codex: "Fixture only.",
              copilot: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "matcher is not supported for UserPromptSubmit",
    );
  });

  it("rejects Codex wiring for unsupported hook events", () => {
    const manifest = {
      controls: [
        {
          id: "hook/codex-failure-guidance",
          kind: "hook",
          hookWiring: {
            event: "PostToolUseFailure",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              codex: {
                matcher: "Bash",
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/failure-guidance.sh"',
                statusMessage: "Explaining failed Bash output",
              },
            },
            notes: {
              claude: "Fixture only.",
              copilot: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "codex does not support PostToolUseFailure",
    );
  });

  it("rejects Claude additionalContext output on events that cannot inject it", () => {
    const manifest = {
      controls: [
        {
          id: "hook/post-compact-context",
          kind: "hook",
          hookWiring: {
            event: "PostCompact",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            outputs: ["additionalContext"],
            harnesses: {
              claude: {
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/session-state.sh",
              },
            },
            notes: {
              codex: "Fixture only.",
              copilot: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "claude PostCompact does not support additionalContext output",
    );
  });

  it("rejects Codex additionalContext output on SubagentStop", () => {
    const manifest = {
      controls: [
        {
          id: "hook/codex-subagent-context",
          kind: "hook",
          hookWiring: {
            event: "SubagentStop",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            outputs: ["additionalContext"],
            harnesses: {
              codex: {
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/subagent-context.sh"',
                statusMessage: "Checking subagent stop conditions",
              },
            },
            notes: {
              claude: "Fixture only.",
              copilot: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "codex SubagentStop does not support additionalContext output",
    );
  });

  it("accepts Claude Stop systemMessage output", () => {
    const manifest = {
      controls: [
        {
          id: "hook/claude-stop-user-warning",
          kind: "hook",
          hookWiring: {
            event: "Stop",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            outputs: ["systemMessage"],
            harnesses: {
              claude: {
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/stop-reminder.sh",
              },
            },
            notes: {
              codex: "Fixture only.",
              copilot: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).not.toThrow();
  });

  it("accepts Claude SubagentStop systemMessage output", () => {
    const manifest = {
      controls: [
        {
          id: "hook/claude-subagent-stop-user-warning",
          kind: "hook",
          hookWiring: {
            event: "SubagentStop",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            outputs: ["systemMessage"],
            harnesses: {
              claude: {
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/subagent-stop-reminder.sh",
              },
            },
            notes: {
              codex: "Fixture only.",
              copilot: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).not.toThrow();
  });

  it("rejects Codex Stop systemMessage output", () => {
    const manifest = {
      controls: [
        {
          id: "hook/codex-stop-user-warning",
          kind: "hook",
          hookWiring: {
            event: "Stop",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            outputs: ["systemMessage"],
            harnesses: {
              codex: {
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/stop-reminder.sh"',
                statusMessage: "Checking repository stop conditions",
              },
            },
            notes: {
              claude: "Fixture only.",
              copilot: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "codex Stop does not support systemMessage output",
    );
  });

  it("accepts Copilot PreToolUse decisionBlock output", () => {
    const manifest = {
      controls: [
        {
          id: "hook/copilot-pre-deny",
          kind: "hook",
          hookWiring: {
            event: "PreToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            outputs: ["decisionBlock"],
            harnesses: {
              copilot: {
                matcher: "create|edit",
                command:
                  'bash "$(git rev-parse --show-toplevel)/.copilot/hooks/protected-files.sh"',
              },
            },
            notes: {
              claude: "Fixture only.",
              codex: "Fixture only.",
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).not.toThrow();
  });

  it("requires a deliberate note for an omitted Copilot target", () => {
    const manifest = {
      controls: [
        {
          id: "hook/no-copilot",
          kind: "hook",
          hookWiring: {
            event: "Stop",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/stop-reminder.sh",
              },
              codex: {
                command: 'bash "$(git rev-parse --show-toplevel)/.codex/hooks/stop-reminder.sh"',
                statusMessage: "Checking repository stop conditions",
              },
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "hook/no-copilot omits copilot wiring without a notes.copilot explanation",
    );
  });

  it("replaces only the Claude hooks key", () => {
    const replaced = replaceClaudeHooksInSettings(BASE_SETTINGS, { Stop: [{ hooks: [] }] });

    expect(replaced).toContain('"env": {\n    "KEEP": "yes"\n  }');
    expect(replaced).toContain('"enabledPlugins": {');
    // type-assertion-boundary: json - JSON.parse of the settings text the
    // function under test just emitted; only the hooks key is asserted on.
    const parsed = JSON.parse(replaced) as { hooks: unknown };
    expect(parsed.hooks).toEqual({ Stop: [{ hooks: [] }] });
  });

  it("does not mistake a string value for the Claude hooks key", () => {
    const settings = `{
  "description": "hooks",
  "hooks": {
    "PreToolUse": []
  }
}
`;

    const replaced = replaceClaudeHooksInSettings(settings, { Stop: [{ hooks: [] }] });
    const parsed = JSON.parse(replaced) as { description: string; hooks: unknown };

    expect(parsed.description).toBe("hooks");
    expect(parsed.hooks).toEqual({ Stop: [{ hooks: [] }] });
  });

  it("replaces hooks with compact JSON and whitespace before the colon", () => {
    const settings = `{"env":{"KEEP":"yes"},"hooks" : [],"after":{"hooks":"keep"}}`;

    const replaced = replaceClaudeHooksInSettings(settings, { Stop: [{ hooks: [] }] });

    expect(replaced.endsWith("\n")).toBe(false);
    expect(JSON.parse(replaced)).toEqual({
      env: { KEEP: "yes" },
      hooks: { Stop: [{ hooks: [] }] },
      after: { hooks: "keep" },
    });
  });

  it("ignores nested hooks keys before the top-level Claude hooks key", () => {
    const settings = `{
  "adapter": {
    "hooks": {
      "PreToolUse": [
        {
          "keep": true
        }
      ]
    }
  },
  "hooks": {
    "PreToolUse": []
  }
}
`;

    const replaced = replaceClaudeHooksInSettings(settings, { Stop: [{ hooks: [] }] });

    expect(JSON.parse(replaced)).toEqual({
      adapter: {
        hooks: {
          PreToolUse: [{ keep: true }],
        },
      },
      hooks: { Stop: [{ hooks: [] }] },
    });
  });

  it("uses JSON string parsing when matching escaped top-level hooks keys", () => {
    const settings = `{
  "h\\u006foks": [],
  "near\\u002dhooks": true
}
`;

    const replaced = replaceClaudeHooksInSettings(settings, { Stop: [{ hooks: [] }] });

    expect(JSON.parse(replaced)).toEqual({
      hooks: { Stop: [{ hooks: [] }] },
      "near-hooks": true,
    });
  });

  it("throws a clear error when the top-level Claude hooks key is missing", () => {
    const settings = `{
  "env": {
    "KEEP": "yes"
  }
}
`;

    expect(() => replaceClaudeHooksInSettings(settings, { Stop: [{ hooks: [] }] })).toThrow(
      ".claude/settings.json must declare a top-level hooks key",
    );
  });

  it("rejects duplicate manifest control ids instead of emitting duplicated hooks", () => {
    const stopWiring = {
      event: "Stop",
      body: "scripts/ai-hooks/fixture.sh",
      order: 10,
      outputs: ["systemMessage"],
      harnesses: {
        claude: {
          command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/stop-reminder.sh",
        },
      },
      notes: {
        codex: "Fixture only.",
        copilot: "Fixture only.",
      },
    };
    const manifest = {
      controls: [
        { id: "hook/stop", kind: "hook", hookWiring: stopWiring },
        { id: "hook/stop", kind: "hook", hookWiring: stopWiring },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "duplicate control id: hook/stop",
    );
  });

  it("requires a deliberate note for omitted harness targets", () => {
    const manifest = {
      controls: [
        {
          id: "hook/claude-only",
          kind: "hook",
          hookWiring: {
            event: "PreToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              claude: {
                matcher: "Bash",
                command: "bash $CLAUDE_PROJECT_DIR/.claude/hooks/no-direct-db.sh",
              },
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "hook/claude-only omits codex wiring without a notes.codex explanation",
    );
  });

  it("rejects Cursor hook wiring until Cursor exposes a repository hook policy surface", () => {
    const manifest = {
      controls: [
        {
          id: "hook/cursor-policy",
          kind: "hook",
          hookWiring: {
            event: "PreToolUse",
            body: "scripts/ai-hooks/fixture.sh",
            order: 10,
            harnesses: {
              cursor: {
                matcher: "Shell",
                command: "bash scripts/ai-hooks/bash-pre-tool-use.sh",
              },
            },
          },
        },
      ],
    };

    expect(() => renderHookWiringOutputsFromManifest(manifest, BASE_SETTINGS)).toThrow(
      "Cursor has no repository PreToolUse policy surface; agent-cli work cursor uses --force with unrestricted shell",
    );
  });
});
