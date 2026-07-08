# 07 — Already-addressed / stale, out-of-scope, and C1 (binary corruption)

> Proposals only — not implemented. Verified against current HEAD.

The logs are old, so a meaningful fraction of entries are already fixed or refer
to moved files. Recording them here so reviewers don't re-investigate.

## Already addressed / stale (no action)

| Logged pain | Finding at HEAD |
|-------------|-----------------|
| codex `&` + `run_in_background` double-background (I1) | Already warned in `.claude/skills/codex-cli/SKILL.md:38,90`. Optional polish only — see [05](05-commit-codex-typecheck.md). |
| codex review refuses to read files on "do not run any commands" (I2) | Already blessed phrasing in `SKILL.md:58-65`; this is the durable fix the log's `feedback_codex_review_phrasing` memory couldn't provide. |
| `docs:lint-coverage-map:check` reach gap on `scripts/harness-audit.test.ts` (A3) | That file moved to `scripts/harness/harness-audit.test.ts` and now resolves an ESLint config; the specific gap no longer reproduces. (The *structural* default-vs-gate divergence is still real — see [01](01-coverage-map-governance.md#a3).) |
| Coverage-map "same glob marked oppositely" (A4) | Not reproducible at HEAD; all `scripts/drift-ai/*` code rows are uniformly `linted + ratcheted`. (The missing internal-consistency *check* is still worth adding — see [01](01-coverage-map-governance.md#a4).) |
| "tidy hook not type-aware on `scripts/**`" (D3) | Outdated: `scripts/**/*.ts` *are* type-aware in eslint (`base-configs.js:69-71`, `script-configs.js:144-150`). The real gap is `tsc`-only errors — see [03](03-edit-hooks-and-caches.md#d3). |
| `bun run typecheck:scripts` doesn't exist | Correct — it never existed; root `typecheck` already covers `tsconfig.scripts.json`. Stale pack reference; nothing to fix. |
| Coverage map at `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` | Moved to `docs/generated/lint-coverage-map.md`. |
| Review packs say `bun run test:scripts -- <file>` | The bad form is not committed anywhere; it lived in transient packs. The fix is to *provide* a discoverable command — see [02](02-focused-test-ergonomics.md#b1). |
| exit 124 vs gate failure confusion (T1) | Already distinguishable (separate exit code + "TIMED OUT" banner). The budget tightness is the live part — see [06](06-drift-scan-harness-governance.md#t1). |

## Genuinely out-of-scope (harness/tooling layer, not this repo)

- **`Write`-tool corrupting empty/whitespace-only string literals into NUL/SOH
  bytes** (logged task 41a) and **backslash-u escapes in tool content decoding
  to real control bytes**. This is the agent harness's content transport, not the
  Musi codebase. *However*, there is a codebase-addressable mitigation — see
  **C1** below — and a codebase-side test-fixture fix (L1 in
  [04](04-lint-rule-ergonomics.md#l1)).
- **`rg`/`grep` output rendering some tokens as the literal `ln`/`n`** (logged
  tasks 12/33). A Bash-tool display quirk; the files were fine. Harness-layer.
- **Subagent spawn rejecting `agent_type` with `fork_context`** (lint-review leaf
  04). Harness/agent-API ergonomics, not this repo.

## Process notes (not code; low priority)

- **Task "Done" state is free-form prose** (lint-debt log) and **multi-PR/
  checklist tasks don't fit the "one task per run → Done" loop**. These packs live
  in agent-orchestration territory (some outside the repo). If future backlog
  packs under `docs/agent_notes/backlog/` want determinism, adopt a structured
  `Status: Todo|Done|Blocked` field at a fixed position and split checklist rows
  into one-PR sub-tasks up front. Worth a convention note in the backlog README;
  not a code change.
- **Markdown backticks inside `rg` patterns can trigger command substitution**
  (lint-review 03h). Universal shell-quoting discipline (single-quote the
  pattern); not worth a code change or a dedicated memory.

---

## C1 — Markdown tidying noise + the rare "skipped (binary file)" notice — RESOLVED / won't-build

**Status: RESOLVED for the real annoyance (markdown reformatting); the rare binary
notice is accepted as-is. The heavy proposals once sketched here are explicitly
DROPPED.**

**What was happening.** While writing this backlog, two drafts of
`04-lint-rule-ergonomics.md` briefly contained literal control bytes — the Write
transport decoded `\uXXXX`-style escapes into real NUL bytes — so the file
registered as binary and the tidy hook printed
`tidy-edited-file: <path> skipped (binary file)`. Separately and more routinely,
the edit-time hook runs `prettier --write` on markdown, and prettier reflowing
prose (line wrapping, list markers, em-dashes) is low-value noise.

**Resolution (applied this session).** The recurring annoyance is the
*reformatting*, and it is now off for markdown: `docs/` was already in
`.prettierignore`, and **`*.md` has been added**, so the edit-time tidy hook,
`format:changed:check`, and `bun run format` all leave markdown alone. One source
of truth, hook and gate stay consistent, no hook code changed.

**Deliberately NOT doing (reverses the earlier proposal).** The previously
suggested machinery — a "loud unexpected-binary" warning in the tidy hook,
extension/`.gitattributes` detection, and a pre-commit control-byte gate — is
**dropped**. Rationale:
- Markdown is not actually rendered unreadable by a stray byte in normal practice;
  the worry was overblown, and fretting over formatting-quibble notices is itself
  the kind of distraction this backlog is meant to remove.
- The corruption originates in the harness `Write` transport, not the repo — the
  right place to address it is upstream, not by adding repo tooling to babysit a
  rare, hard-to-reproduce edge case.
- The existing soft `skipped (binary file)` notice
  (`scripts/ai-hooks/tidy-edited-file.sh:87-95`, `:271`) is an adequate,
  zero-cost tripwire; it does not need to be made louder or gated.

**Still worth doing (separately, unchanged):** L1 in
[04](04-lint-rule-ergonomics.md#l1) — a shared `buildGitLogFixture` test helper.
That stands on its own as ordinary de-duplication for the drift-ai fixture files
that legitimately need git's NUL/US/GS separators; it is normal test ergonomics,
not anti-corruption tooling, and is unaffected by this decision.

## Applied change (C1)
`.prettierignore` — added `*.md` (markdown is no longer auto-formatted anywhere).
No hook code changed; no new check added.
