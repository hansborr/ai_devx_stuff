# claude backend notes

Verified against claude 2.1.259.

## Models and effort

- `-m` accepts aliases (`fable`, `opus`, `sonnet`, `haiku`) or full ids (`claude-fable-5-1`, `claude-opus-5`, `claude-fable-5`); omitting it runs the user-configured default model.
- Aliases float to the latest release: `fable` runs Claude Fable 5.1 (`claude-fable-5-1`) and `opus` runs Claude Opus 5 (`claude-opus-5`) (verified 2026-09-02 from the `modelUsage` key in the JSON envelope). Claude Fable 5 (`claude-fable-5`) is still served under its full id. Pin the full id when a seat must reproduce an earlier round or a brief names a specific release; use the alias when the brief just says "Fable" or "Opus".
- Dated model ids use hyphens everywhere: `claude-opus-4-8`, never the prose spelling `claude-opus-4.8`. The dotted form is rejected with "There's an issue with the selected model. It may not exist or you may not have access to it", which reads like an entitlement problem rather than a typo (verified 2026-07-27: `canonicalModel: claude-opus-4-8`, first-party, 1M context).
- `-e low|medium|high|xhigh|max` on Claude 5-era models; older models have fewer tiers.

## Consult permission profile

- Print mode never prompts: any tool call not allowed by settings is auto-denied and the run continues, so a consult cannot stall.
- The wrapper adds `--disallowedTools Write,Edit,NotebookEdit,Task`; file reads and read-only shell commands (`git log`/`diff`, `rg`) are auto-allowed; project deny rules still apply.
- Narrow escalations compose via passthrough — `-- --allowedTools 'Bash(bun run test:*)'` — a deliberate, caller-owned crack in the read-only wall; the injected consult preamble carves the grant out so the delegate does not refuse it. Blanket grants (`Bash`, `Bash(*)`, `Task(*)`, `Write`, `Edit`, …), permission-mode overrides, and consult-mode `--settings`/`--mcp-config`/`--disallowedTools` are rejected.
- The cost trailer's `permission-denials` count comes from the JSON envelope; a nonzero count in a consult means the run tried something it shouldn't — worth reading the log.
- Widen readable paths with `-- --add-dir <dir>`.

## Behavior notes

- A resumed run reports a fresh session id in its trailer; use the latest id for the next follow-up.
- The session id lands only in the buffered final JSON envelope, so it reaches the `agent-run: session-id:` trailer only at finalization. A run killed before then leaves no session-id trailer — recover the id from claude's native session history under `~/.claude/`.
