# Useful Custom Hooks (Claude Code / Codex / Cursor)

> **TL;DR** — By mid-2026, lifecycle hooks are the **deterministic wall** around non-deterministic coding agents, and all three major harnesses ship one: **Claude Code** (most mature, ~30+ events), **OpenAI Codex** (a separate, Claude-Code-_inspired_ implementation — overlapping event names, **not** drop-in compatible), and **Cursor** (v1.7, Oct 2025: `beforeShellExecution` / `afterFileEdit` / `beforeReadFile` / `beforeMCPExecution` / `beforeSubmitPrompt` / `stop`). The consensus hook set is small and stable: **format-on-save**, a **typecheck/test gate that feeds errors back into the loop**, **PreToolUse deny-guards** for dangerous commands and protected paths, **notification** pings, and **context-injection** on session start / after compaction. The single load-bearing mechanic everywhere is **exit code 2** (Claude/Codex) or **`permission:"deny"`** (Cursor): it blocks the action _and_ returns the reason to the model so it self-corrects. Treat harness hooks as the fast inner loop and **git hooks (Husky + lint-staged / `pre-commit`) as the enforcement floor** — the same wall must apply to human and agent code alike.

**Top actionable takeaways**

- **Learn the block-and-feedback primitive first.** `echo "reason" >&2; exit 2` (Claude/Codex) or return `{"permission":"deny","agentMessage":"why"}` (Cursor). The reason re-enters the model's context — that is what makes hooks *steer*, not just gate.
- **Format-on-save is the highest-ROI hook.** `PostToolUse` matcher `Edit|Write` → run Biome/Prettier on the edited file only. Agent never burns tokens on whitespace.
- **Wire a fast typecheck/test gate into the loop** — `tsc --noEmit` + *changed-file-scoped* tests (`vitest related`, `jest --findRelatedTests`). Never the full suite (hooks run synchronously and block).
- **PreToolUse deny-guards are the one real security boundary** — they fire *before* the permission check and hold even under `--dangerously-skip-permissions`.
- **Gate dependency installs** (slopsquatting): deny `npm install <pkg>` unless the package is already in `package.json`.
- **Notification hooks** (`notify-send` / `osascript`) reclaim babysitting time at near-zero cost.
- **Keep hooks fast; formatters fail-soft (`exit 0`), gates fail-hard (`exit 2`).** Start with 1–2 hooks, not a 10-hook gauntlet.

See also: [Overview](00-overview.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [Linting for AI](09-linting-for-ai.md) · [Supply-Chain Security](14-security-and-supply-chain.md)

---

## The one mechanic to understand: block-and-feedback

A guardrail hook is only useful if its failure reason **re-enters the model's context**. A silent failure or a generic "command failed" wastes a whole turn; a precise reason lets the agent fix and retry in-loop.

**Claude Code / Codex** use exit codes:

- **Exit 0** = no objection; normal permission flow continues. (To pass *additional context* on exit 0, print JSON to stdout.)
- **Exit 2** = block **and** send `stderr` back to the agent as feedback. This applies to `PreToolUse`, `UserPromptSubmit`, and `Stop`.
- **Any other non-zero** = non-blocking error (logged, agent continues).
- **Never mix exit 2 with JSON** — JSON on stdout is ignored when you exit 2. Use *either* exit-2+stderr *or* exit-0+JSON.

```bash
#!/usr/bin/env bash
# .claude/hooks/guard-bash.sh — PreToolUse matcher: Bash
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$CMD" | grep -qE 'rm -rf|git push --force|chmod 777|curl[^|]*\| *(ba)?sh'; then
  echo "Blocked: destructive command. Use a safer, reversible alternative." >&2
  exit 2
fi
exit 0
```

**Cursor** returns JSON on stdout instead:

```json
{ "permission": "deny", "agentMessage": "why the agent should change course", "userMessage": "what the human sees" }
```

`agentMessage` goes to the model; `userMessage` to the human. **Caveat:** the response shape varies by event — `permission` (`deny`/`allow`/`ask`) plus `agentMessage`/`userMessage` is for `beforeShellExecution`, `beforeMCPExecution`, and file/read hooks; `beforeSubmitPrompt` uses a simpler `{ "continue": boolean }` shape.

> **Where blocking actually reverts the action:** `PreToolUse` (before the tool runs) and `Stop` (at turn end) are *genuine* blocks. **`PostToolUse` runs after the edit already happened** — exit 2 there does **not** undo the write; it surfaces the error so the model decides whether to correct on the next turn. Plan your gate placement accordingly.

## The consensus hook set

### 1. Format-on-save (`PostToolUse`) — highest ROI

A `PostToolUse` hook matching `Edit|Write|MultiEdit` extracts the edited path and formats just that file. No tokens spent on whitespace, import order, or quote style.

```json
{ "hooks": { "PostToolUse": [ {
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [ { "type": "command",
    "command": "jq -r '.tool_input.file_path' | { read f; case \"$f\" in *.ts|*.tsx|*.js|*.jsx|*.json) npx biome format --write \"$f\";; esac; }; exit 0"
  } ] } ] } }
```

Notes: scope to JS/TS extensions; **append `exit 0` so a formatter hiccup never deadlocks the agent** (this is a *formatter*, not a gate — see §"fail-soft"). **Biome** (one fast binary; formats + lints) is increasingly preferred over Prettier+ESLint for hook latency. Cursor's equivalent is an `afterFileEdit` hook reading `payload.file_path` (commonly `bun run hooks/after-file-edit.ts`).

### 2. Typecheck / test gate (feeds errors back) — keep it FAST

Two placements:

- **`PostToolUse`** — run `eslint <file>` / `tsc --noEmit` after each edit; exit 2 surfaces errors so the model corrects next turn (*does not revert the edit*).
- **`Stop`** — run the gate once per turn *before the agent is allowed to finish*; return `{"decision":"block","reason":"<failures>"}` to bounce it back.

**Performance rule (non-negotiable):** hooks block the session synchronously. Do **not** run the full suite. Run `tsc --noEmit` (whole-project typecheck is global but fast on incremental builds) and **changed-file-scoped tests only**: `vitest related <files> --run` or `jest --findRelatedTests <files>`.

```python
#!/usr/bin/env python3
# Codex Stop hook (command handler). Guard against the loop.
import json, subprocess, sys
payload = json.load(sys.stdin)
if payload.get("stop_hook_active"):     # the ONLY built-in loop guard — must check it
    sys.exit(0)
r = subprocess.run(["sh","-c","npx tsc --noEmit && npx vitest related $(git diff --name-only) --run"],
                   capture_output=True, text=True)
if r.returncode != 0:
    tail = (r.stdout + r.stderr)[-500:]   # truncate to protect context
    print(json.dumps({"decision":"block","reason":f"Gate failed. Fix before finishing:\n{tail}"}))
sys.exit(0)
```

> **Stop-hook loop guard — read carefully.** The only documented built-in protection is the **`stop_hook_active` flag**, which your script must check and early-exit on. An automatic override after a fixed number of consecutive blocks has been **proposed in discussion (numbers like ~5–10 floated) but is _not_ shipped/documented behavior** — do not rely on a "Claude overrides after N blocks" cap. An always-block Stop hook that ignores `stop_hook_active` will loop until the session limit.

Why in-loop: a type/test error caught here costs one cheap retry; caught in CI it costs CI minutes plus a human round-trip. `tsc --noEmit` is the canonical TS gate across every 2026 source (see [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md)).

### 3. PreToolUse deny-guards — the real security boundary

`PreToolUse` hooks fire **before any permission-mode check**, so a `deny` (or exit 2) blocks the tool **even under `--dangerously-skip-permissions` / bypassPermissions**. Hooks can *tighten* but never *loosen* permission rules — this is the one hook that is a genuine, unbypassable control rather than a convenience. (confidence: **high**)

Two standard guards:

1. **Bash command guard** — regex-deny `rm -rf`, `chmod 777`, `curl … | sh`, `git push --force` against `tool_input.command` (see §1 snippet).
2. **Protected-file guard** — deny `Edit`/`Write` on `.env*`, `.git/`, lockfiles (`package-lock.json`, `pnpm-lock.yaml`), `node_modules/` by matching `tool_input.file_path`.

```json
{ "hooks": { "PreToolUse": [ {
  "matcher": "Edit|Write",
  "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-files.sh" } ]
}, {
  "matcher": "Bash",
  "if": "Bash(git *)",
  "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard-git.sh" } ]
} ] } }
```

Keep deny-lists in a **script file**, not inline JSON, for maintainability. The **`if` field** (Claude Code v2.1.85+) scopes a hook to specific commands (e.g. `"if": "Bash(git *)"`) so the process only spawns on matching commands. Cursor mirrors this with `beforeShellExecution` (deny) and `beforeReadFile` (block the agent from even *reading* a secret file).

### 4. Block unreviewed dependency installs (slopsquatting guard)

Agents run `npm install <pkg>` / `pip install <pkg>` on their own, and hallucinated / typo-squatted package names ("slopsquatting") are a documented supply-chain risk (see [Supply-Chain Security](14-security-and-supply-chain.md)). A `PreToolUse` Bash hook can deny installs of packages **not already in `package.json`**, forcing a human to add new deps — and the same hook fixes the mundane "agent uses `npm` in a `pnpm` repo" problem by denying the wrong package manager. Production tooling exists (the open-source `attach-guard` plugin intercepts installs and checks them against supply-chain risk data). (confidence: **medium** — pattern is sound; specific tools evolving)

```bash
# PreToolUse matcher Bash, if Bash(npm install *|pnpm add *)
PKG=$(echo "$CMD" | grep -oE '(install|add) +[^ ]+' | awk '{print $2}')
grep -q "\"$PKG\"" package.json || { echo "New dependency '$PKG' must be reviewed and added to package.json by a human." >&2; exit 2; }
```

### 5. Notification hooks — get pinged when the agent needs you

Lowest-effort, highest quality-of-life hook. Claude Code's `Notification` event fires when the agent waits for input/permission or is idle.

```json
{ "hooks": { "Notification": [ { "matcher": "",
  "hooks": [ { "type": "command", "command": "notify-send 'Claude Code' 'needs your attention'" } ] } ] } }
```

Cross-platform: macOS `osascript -e 'display notification …'`, Linux `notify-send`, Windows PowerShell MessageBox. Matchers target `permission_prompt` (needs approval) vs `idle_prompt` (done, awaiting next prompt). **Codex** has both a full hooks system *and* an older `notify` program (an external program invoked on `agent-turn-complete`) — set `notify = ["my-notify-script"]` in `~/.codex/config.toml`. Note: **Codex ignores `notify` (and `provider`/`telemetry`) keys in *project-local* `config.toml` for security — they must be set at user level.**

### 6. Context-injection on `SessionStart` / after compaction

Anything a `SessionStart` hook writes to stdout is added to the model's context. Use it for **dynamic** orientation (recent commits, branch, package manager). The highest-value variant uses **matcher `compact`**: after compaction summarizes/loses detail, re-inject the non-negotiable rules so the agent doesn't drift mid-session.

```json
{ "hooks": { "SessionStart": [ { "matcher": "compact",
  "hooks": [ { "type": "command",
    "command": "echo 'Reminder: use pnpm not npm. Run pnpm typecheck && pnpm test before committing.'" } ] } ] } }
```

For **static, always-true** rules prefer `CLAUDE.md` / `AGENTS.md` over a hook; reserve hooks for **dynamic or post-compaction** context. `SessionStart` blocks session start and supports only `command`/`mcp_tool` handlers — keep it fast. `UserPromptSubmit` can inject per-prompt context via `additionalContext`.

## Git hooks: the enforcement floor (not optional)

**Harness hooks fire only inside that harness**, and the official docs note an agent can **bypass an `Edit`-matched hook by writing files via Bash** (e.g. `echo … > file.ts`). The durable wall is **git hooks**, which apply identically to agent and human commits. Mitigation inside the harness: also match `Bash` and scan `git status --porcelain` in a `Stop` hook — but treat that as defense-in-depth, not the wall.

Consensus staged design (fastest-first):

| Stage | Latency | What runs | Tool |
|---|---|---|---|
| **pre-commit** | seconds | lint + format + **secret-scan** on *staged* files | Husky + `lint-staged` |
| **pre-push** | seconds–min | `tsc --noEmit`, targeted tests, dead-code (`knip`) | Husky |
| **CI** | min | full suite + everything | (see [CI/CD Gates](04-static-analysis-and-ci-cd-gates.md)) |

```bash
# .husky/pre-commit
npx lint-staged          # eslint --fix + prettier/biome --write on staged files + secret scan

# .husky/pre-push
npx tsc --noEmit || exit 1
npx vitest related --run
```

Use the **`pre-commit` framework** for polyglot repos. Principle: *nothing merges to main without passing every stage — same pipeline for human and agent code, no exceptions.* Layer harness `PostToolUse` hooks on top for instant in-loop feedback; you want **both**, not one.

## TypeScript / React / Storybook specifics

- **Canonical TS gate:** `tsc --noEmit`. The bundler's transpile-only build does **not** typecheck — make it a dedicated check.
- **TDD Guard** — a widely-used plugin that uses `PostToolUse` to enforce red-green-refactor as a hard wall: (1) **Test-First** (blocks implementation with no failing test), (2) **Minimal Implementation** (blocks gold-plating beyond the failing test), (3) **Lint Integration** (enforces the refactor step). Ships **native reporters for Vitest, Jest, and Storybook** (plus pytest/Go/cargo/RSpec/PHPUnit), so a TS/React/Storybook stack works out of the box. **It installs via its own third-party plugin marketplace, _not_ Anthropic's official Claude Code marketplace:** `/plugin marketplace add nizos/tdd-guard` → `/plugin install` → `/tdd-guard:setup` (auto-wires the reporter and registers the hook). This moves TDD from advisory prose to a harness-level gate. (confidence: **high**; actively maintained — frequent releases, e.g. core `v1.6.8` and a `minitest-v0.2.0` package release in May 2026)
- **Vitest 4.1** ships a dedicated **AI-agent reporter** — compact, machine-parseable output ideal for feeding back through a gate hook.
- **"Linters as law" (Factory.ai):** an agent ignores prose docs but **cannot ignore a lint error** returned by a hook. Workflow: spot a recurring anti-pattern → have an LLM draft a custom ESLint rule (severity + `--fix` + tests + **a clear, structured error message**, because *that message is the prompt the agent reads*) → run repo-wide → autofix in parallel → put it on the hot path (pre-commit, CI, **and** the `PostToolUse` lint hook). For architecture boundaries prose can't hold (no cross-feature imports, design-system-only components), use `eslint-plugin-boundaries` / `dependency-cruiser`. See [Linting for AI](09-linting-for-ai.md). (confidence: **high**)
- **Storybook a11y as a gate:** set `parameters.a11y.test = 'error'` and run the Storybook Vitest project as a required check so every story is a test the agent must keep green.

## Advanced: prompt & agent hooks (use sparingly)

Beyond command hooks, Claude Code supports **`type:"prompt"`** hooks (a single fast-model call returning `{ok, reason}` — e.g. a `Stop` hook asking "are all requested tasks actually complete?") and **experimental `type:"agent"`** hooks (a subagent that can read files/run commands, up to ~50 tool turns — e.g. "run the suite and confirm it passes before allowing Stop"). These express *judgment* checks deterministic tools can't. **Caveat:** they add latency + cost and are themselves non-deterministic (can hallucinate) — **prefer a deterministic command hook whenever a tool can guarantee the property.** Keep compile/type/lint/test on command hooks; reserve LLM-judge hooks for genuinely judgment-based gates. **Note: Codex supports _command_ hooks only — `prompt`/`agent` handlers are parsed but skipped.** (confidence: **medium**; agent hooks experimental)

## Operational hygiene

- **Per-edit hooks: changed-file scope only.** `jest --findRelatedTests` / `vitest related` — never the full suite.
- **Formatters fail-soft (`exit 0`); gates fail-hard (`exit 2`).** A Prettier crash must never deadlock the agent; a type error must.
- **Start with 1–2 hooks** (format + one gate), then expand. A 10-hook gauntlet built up front just makes a slow agent.
- **Stop hooks: early-exit on `stop_hook_active`.** (The only built-in loop guard — see §2.)
- **Prefer exec form (`"args": [...]`)** over a shell string to avoid quoting bugs; watch for shell-profile `echo` statements corrupting JSON stdout (guard them behind an interactive-shell check).
- **Audit hook config every 3–6 months** as part of harness maintenance — prune what no longer earns its latency. (confidence: **medium** — sound practice, partially documented vs. strict cross-source consensus)

## Harness config quick-reference

| | Config location | Block primitive | Notes |
|---|---|---|---|
| **Claude Code** | `~/.claude/settings.json` (global), `.claude/settings.json` (project, committable), `.claude/settings.local.json` (gitignored), plugin `hooks/hooks.json` | `exit 2`+stderr **or** exit-0+JSON (`permissionDecision`, `decision:block`, `additionalContext`) | ~30+ events (31 in current ref); handlers: `command`, `http`, `mcp_tool`, `prompt`, `agent`; `if` field v2.1.85+ |
| **OpenAI Codex** | `hooks.json` or inline `[hooks]` in `config.toml` | `exit 2` / `decision:block` | Separate impl, **not** drop-in compatible; **command hooks only**; **`PreToolUse` does not reliably fire for some calls (e.g. structured patches)** today; older `notify` program still works |
| **Cursor** (v1.7) | `.cursor/hooks.json` | `{"permission":"deny","agentMessage":…}` (shape varies by event) | `beforeShellExecution`/`afterFileEdit`/`beforeReadFile`/`beforeMCPExecution`/`beforeSubmitPrompt`/`stop` |

## Debates & trade-offs (don't overclaim)

- **Harness hooks vs. git hooks** isn't either/or. Harness hooks give *speed and in-loop feedback*; git hooks give a *wall the agent literally cannot commit past*. Run both.
- **Deterministic vs. LLM-judge hooks.** Command/type/lint/test gates are reliable walls; prompt/agent hooks are flexible but can hallucinate. Use the former by default, the latter only for true judgment calls.
- **Over-eager hooks are the failure mode.** A slow or deadlocked agent erodes the productivity the hooks were meant to protect. Latency budget is a feature, not an afterthought.
- **Codex compatibility is overstated in the wild.** "Claude-Code-compatible" is marketing shorthand for "similar event names." Different config files, command-hooks-only, and a known `PreToolUse` reliability gap mean you cannot copy a Claude hook into Codex unchanged.

## Freshness (2026)

- **Current:** Claude Code ~30+ events + `if` field (v2.1.85+) + `prompt`/`agent` handler types; `PostToolUse` format-on-save and `tsc --noEmit` gate patterns; `PreToolUse` firing before permission checks (unbypassable); Cursor v1.7 hook event names; TDD Guard (third-party marketplace, native Vitest/Jest/Storybook reporters); Vitest 4.1 AI-agent reporter; Factory.ai "linters as law"; Husky + lint-staged / `pre-commit` staged gates.
- **Stale / corrected:** the "8-block Stop cap" (**never shipped** — only `stop_hook_active` is real); "Codex hooks are Claude-Code-_compatible_" (**separate implementation**); "~25 events" (**now ~31**); "TDD Guard on the official marketplace" (**its own `nizos/tdd-guard` marketplace**); Codex `notify` "warns" on project-local config (it **silently ignores** `notify`/`provider`/`telemetry`; the documented *warning* is for mixing `hooks.json` + inline hooks in one layer).
- **Watch:** Codex's hooks system is youngest and changing fastest (the `PreToolUse`/structured-patch gap, possible `prompt`/`agent` handler support); a Stop-hook iteration cap is proposed and may ship. Re-check quarterly.

## Sources

- [Claude Code — Hooks reference](https://code.claude.com/docs/en/hooks) · [Hooks guide](https://code.claude.com/docs/en/hooks-guide) (2026)
- [Codex CLI hooks — complete guide (events, policy, patterns)](https://codex.danielvaughan.com/2026/04/15/codex-cli-hooks-complete-guide-events-policy-patterns/) (third-party, 2026-04-15) · [OpenAI Codex — advanced config](https://developers.openai.com/codex/config-advanced) (2026)
- [Cursor — Hooks docs](https://cursor.com/docs/hooks) (2025–2026)
- [TDD Guard](https://github.com/nizos/tdd-guard) (2026) · [InfoQ — Vitest 4.1 for AI agents](https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/) (2026-05)
- [Factory.ai — Using linters to direct agents](https://factory.ai/news/using-linters-to-direct-agents) · [Factory-AI/eslint-plugin](https://github.com/Factory-AI/eslint-plugin) · [Understanding Data — custom ESLint rules for determinism](https://understandingdata.com/posts/custom-eslint-rules-determinism/) (2026)
- [Morph — Claude Code hooks](https://www.morphllm.com/claude-code-hooks) · [Pixelmojo — Claude Code hooks: production CI/CD patterns](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns) (2026)
- [Jones Russell — Git hooks for AI agents](https://jonesrussell.github.io/blog/git-hooks-ai-agents/) · [reccehq — build these gates before agents touch your codebase](https://blog.reccehq.com/before-you-let-agents-touch-your-codebase-build-these-gates) (2026)
- [attach-guard — blocking compromised packages before install](https://dev.to/hammadtariq/i-built-a-claude-code-plugin-that-blocks-compromised-packages-before-installation-1o3l) · [Bishop Fox — AI code security guardrails checklist](https://bishopfox.com/resources/security-guardrails-ai-code-checklist) (2026)
- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) · [Anthropic — Claude Code in large codebases: best practices](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start) (2026)
