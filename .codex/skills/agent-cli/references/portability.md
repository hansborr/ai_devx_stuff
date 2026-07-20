# Portability and prerequisites

Notes for copying this skill into another repo or provisioning a new
environment. Callers dispatching in an already-working repo do not need them.

- The wrapper is self-contained bash with no build step: copy
  `.claude/skills/agent-cli/` wholesale.
- Normal dispatch needs `bash`, the target CLI on `PATH`, `git`,
  GNU-compatible `realpath -m`, and standard Unix text/process utilities.
  Copilot additionally needs a logged-in `copilot login`; cursor needs
  `agent login`.
- For cursor consults to gather their own branch diff (rather than depending on
  `-f` attachments), the target repo must commit a `.cursor/cli.json` with a
  read-only `git` allowlist — copy Musi's. It re-permits read-only `git` in
  ask mode; without it, cursor consults fall back to file reads plus whatever
  `-f` material the caller supplies. Requires the cursor account's default
  `approvalMode: "allowlist"` (sandbox disabled). See [cursor.md](cursor.md).
  Copy `.cursor/cli.json` **whenever you copy the skill for cursor consults**:
  the injected consult preamble now promises "git diff is fine" unconditionally,
  so porting only `.claude/skills/agent-cli/` without the allowlist leaves a
  false contract — cursor's `git` commands are denied and it silently degrades
  to the `-f` fallback while still being told the diff is reachable.
- `flock` is required for lock-holding runs (`work`); without it the wrapper
  exits 3 before launching. Lock-free read-only runs (consults, codex review)
  do not need it — without it they only lose the drift-attribution lock probe.
- `python3` is needed only by the claude and cursor backends (JSON
  result-envelope parsing for `-o` and trailers).
- Degraded gracefully: `setsid` (when present) lets TERM/INT/HUP signal the
  whole backend process group; `fuser`/`lsof` only improve the busy-lock
  holder message.
- Validation: run `shellcheck .claude/skills/agent-cli/scripts/agent-run.sh`
  (in Musi the lint lane already ShellChecks `.claude/skills/**/*.sh`).
- The backend references name CLI versions and model ids that age quickly
  (the "Verified against ..." lines); re-check the local CLI help/catalog
  after upgrades or when porting the skill.
