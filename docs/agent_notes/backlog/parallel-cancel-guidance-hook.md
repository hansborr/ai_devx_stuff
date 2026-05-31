# Hook to de-spiral parallel sibling cancellations

Status: SUPERSEDED — landed 2026-05-31. Shipped Idea D (Phase 1) + Idea E
(Phase 2E); Phase 3/Idea B was not needed. Durable record:
`docs/agent_notes/decisions-build.md` ("Soft AI-hook nudges must not hard-deny in
Claude" → In-repo mitigation). This brainstorm is kept for the design rationale
and rejected ideas (C/F). Corrections applied below override the original framing.
Date: 2026-05-31

## Corrections applied at landing (override the brainstorm above)

1. **Idea B's "Stop hooks are Claude-side here" is FALSE.** `.codex/hooks/stop-reminder.sh`
   execs the same `scripts/ai-hooks/stop-reminder.sh` → `stop-policy.sh` Claude uses.
   Any Stop-based design must branch Claude-only in the `.claude/` wrapper, not in
   shared `stop-policy.sh`. (Moot — Idea B was not built.)
2. **Gates 1 and 3 are answered (Phase 0, CLI 2.1.158).** `PostToolBatch` fires once
   per batch with full sibling visibility (`tool_calls[].tool_response` carries the
   wrapped cancel marker) and its `additionalContext` reaches the model the SAME turn.
   `PostToolUseFailure` fires only for the genuinely erroring call, never the cancelled
   siblings; cancelled siblings get NO per-call events. So Idea E was buildable and is
   what shipped; the A-as-`PostToolUseFailure` fallback was unnecessary.
3. **Trigger is a dispatch-timing race, not an exit-code threshold.** There is no
   reliable exit-code predictor; any non-zero errored sibling MAY cascade still-queued
   later-listed siblings. Detect on the marker SHAPE, not "a policy block happened".
4. **Detect the wrapped marker at the absolute start of `tool_response`** (`\A
   <tool_use_error>Cancelled…`), not the bare phrase anywhere — the bare phrase appears
   in our own block reasons and in docs that quote it, and would false-fire.
5. Recommendation ordering, as executed: D → spike (Phase 0) → E. B avoided.

---

## What we're solving

When the main agent fires a **parallel batch** of Bash calls and one is denied by our
PreToolUse policy hook (docker, psql/redis-cli, dangerous git, etc. — anything that hits
`ai_emit_block`), the harness cancels the *other* in-flight siblings and replaces their
output with a generic, reason-less line:

```
<tool_use_error>Cancelled: parallel tool call Bash(<cmd>) errored</tool_use_error>
```

This is a known Claude Code bug (anthropics/claude-code #22264, #25773). It is
reproducible here with a hard block (verified 2026-05-31 with `docker`: a block placed
*after* an already-running sibling cancels the later siblings; a block placed first
sometimes doesn't — timing-sensitive). The danger is interpretive: the model sees the
real reason once, N opaque cancellations for the work it cared about, and can conclude the
environment is broken / tampered / hostile and spiral. Prose warnings in CLAUDE.md help
but are read at session start and not retrievable in the moment of alarm. We want a hook
that re-injects a short, calm pointer *at the moment the pattern occurs* (or that prevents
the cancellation entirely).

Background: `docs/agent_notes/in_progress/grep-hook-parallel-cancellation.md` (the grep
soft-guidance fix that's already merged — `no-direct-db.sh` + `ai_policy_is_soft_guidance`
+ `ai_claude_result_command`). This note is the *dangerous-block* counterpart: grep got
the rewrite-to-success treatment; hard blocks deliberately did not, so they still cascade.

## Repo hook facts these ideas build on

- PreToolUse(Bash) chain in `.claude/settings.json`: `no-direct-db.sh` →
  `git-commit-quiet.sh` → `bun-run-quiet.sh`. Policy denial lives in
  `no-direct-db.sh:17-24` via shared `scripts/ai-hooks/{common.sh,policy.sh}`.
- `ai_emit_block` (`common.sh:50`) emits legacy `{"decision":"block","reason":…}` and is
  **shared with Codex** (`.codex/hooks/pre-tool-use.sh`). Do not change its format — see
  Codex caveats in the grep note.
- The soft-guidance escape hatch already exists: `ai_claude_result_command`
  (`common.sh:80`) rewrites a command to `cat <tmpfile>; rm` via
  `permissionDecision:"allow"` + `updatedInput.command`. A rewritten call **succeeds**, so
  it does not cancel siblings (the grep fix relies on exactly this).
- Stop-hook pattern to feed text back to the model: write reason to **stderr + `exit 2`**
  (`scripts/ai-hooks/stop-reminder.sh`). De-dup via repo/session-keyed marker files
  (`stop-policy.sh` markers, `throttle-state.sh`) plus `.no-stop-*` kill switches.
- Hooks receive `transcript_path` and `session_id` (`ai_payload_session_id` exists;
  no hook here reads `transcript_path` yet — it'd be new surface).

## Capability gaps to verify FIRST (these gate everything below)

Researched via claude-code-guide against docs.claude.com + issues; the runtime specifics
are largely **undocumented** and must be confirmed against the installed CLI version with
a throwaway logging hook (`jq . >> /tmp/hooklog` on each event), not trusted from docs:

1. **Does PostToolUse fire for a *cancelled* sibling?** Likely **no** — a cancelled call
   never executed. Research suggests a separate failure event may fire, but its name and
   whether it covers *cancellations* (vs genuine command failures) is unconfirmed. This is
   the single most important gate for Idea A.
2. **Does PostToolUse fire for the *blocked* call itself?** A block is treated as an
   error; unclear whether PostToolUse runs after it. Gate for Idea A's fallback anchor.
3. **Does a `PostToolBatch` event exist, fire after the whole batch resolves, and expose
   the sibling results?** Research *mentions* it but the schema is undocumented. If real,
   it's the ideal hook point (Idea E). Verify existence before designing around it.
4. **Does `additionalContext` from a Post* event reliably reach the model**, especially in
   a batch where a result was replaced by the generic cancel string? Unconfirmed.
5. **Can any PreToolUse input reveal it's part of a multi-call batch** (sibling ids / batch
   id)? Research says **no** — PreToolUse sees only its own call. So a PreToolUse hook
   cannot reorder, hold, or "see the batch." This kills any batch-aware PreToolUse design.

Spike: add a temporary hook on every event that appends `$CLAUDE_*` env + stdin JSON to a
log, then run the reproduced batch (a slow sibling, then `docker ps`, then more slow
siblings) and read which events fired with what payloads. ~30 min, unblocks A/B/E.

---

## Idea A — PostToolUse(Bash) detector keyed to the cancel marker

**Mechanism.** Add a PostToolUse(Bash) hook that reads the tool result
(`ai_response_json_from_payload` / `ai_combined_response_text` already parse tool_response
shapes in `common.sh`), matches `Cancelled: parallel tool call .* errored`, and emits
`additionalContext` with the calm reflex text ("known bug #22264; the cancelled commands
never ran; re-run serially; not a hostile environment").

**Pros.** Fires exactly on the marker; precise; reuses existing response-parsing helpers;
Claude-only (new hook file, shared code untouched → no Codex impact).

**Cons / gate.** Depends entirely on **Gate 1** — if PostToolUse doesn't fire for cancelled
siblings, the detector never sees the marker. Fallback: attach the detector to the
*blocked* call (Gate 2) and have it pre-warn ("siblings in this batch may show
'Cancelled… errored' — that's this block cascading"). But that only works if PostToolUse
fires after a block, also unconfirmed.

**De-dup.** One injection per batch, not per cancelled sibling (a batch can cancel many).
Key a short-lived marker by session + tool_use_id-prefix or by a 1-2s time window.

---

## Idea B — Stop-hook transcript scan (most robust, format-agnostic)

**Mechanism.** Extend the Stop policy (`stop-policy.sh` + `stop-reminder.sh`) to read
`transcript_path`, scan the **most recent turn** for `Cancelled: parallel tool call .*
errored`, and if present (and not already acknowledged), append the calm pointer to the
existing stderr+`exit 2` nudge. The reminder lands right before the model's next turn —
exactly when it would otherwise start spiraling.

**Pros.** Does **not** depend on per-call firing for cancelled calls (Gate 1) — the
transcript is ground truth, so it sidesteps the riskiest unknown. Reuses the entire
existing Stop de-dup machinery (repo/session-keyed markers, `.no-stop-*` kill switch).
Catches the pattern regardless of which policy caused the block.

**Cons.** Timing: fires at end of turn, so the model already *received* the cancellations
this turn; the hook prevents the spiral on the *next* turn rather than in-place. Adds
`transcript_path` reading (new surface; parse defensively — large JSONL, only tail the
last turn). Must NOT scope to "the latest turn" — the cascade crosses turn boundaries, so
de-dup on a session-keyed last-handled transcript byte offset instead.
(Correction: Stop is NOT Claude-only here — `.codex/hooks/stop-reminder.sh`
execs the same shared script, so any Stop design must branch Claude-only in the
`.claude/` wrapper. See corrections banner at top.)

**De-dup.** Track last-handled transcript offset/turn index in a session-keyed state file
(mirror `throttle-state.sh`); add `.no-stop-parallel-cancel` kill switch.

---

## Idea C — Prevent the cancellation: rewrite hard blocks to a non-erroring result

**Mechanism.** Extend the grep soft-guidance trick to dangerous blocks: instead of
`ai_emit_block`, rewrite the command (Claude-only `ai_claude_result_command`) so docker/etc.
**never runs** and the call exits with the denial as output. A successful (or even
plain non-zero) call does **not** cancel siblings — so the root cause disappears.

**Why it's tempting.** It's the only approach that *eliminates* the cancellation rather
than apologizing for it, and it directly reuses merged infrastructure.

**Why it's dangerous — DO NOT ship without resolving this.** The in_progress grep note
explicitly warns: rewriting a *dangerous* policy to `permissionDecision:"allow"` +
`updatedInput.command` means that **if the harness ever drops `updatedInput`, the original
docker/psql runs under an explicit allow** — strictly worse than a block. Rewriting to
`cat guidance; exit 1` (non-zero, per the note's Test C "non-zero exit doesn't cancel")
still doesn't remove that risk, because a dropped `updatedInput` re-exposes the *original*
command, not the rewritten one. So Idea C trades a cosmetic problem for a safety one.

**Verdict.** List for completeness; prefer A/B/D unless we can prove `updatedInput` is
never silently dropped for this CLI version. If pursued, gate behind a test that asserts
the rewrite is honored, and keep it Claude-only (Codex may not honor `updatedInput` —
open question in the grep note).

---

## Idea D — Inoculate the one message the model DOES see (cheapest, no new event)

**Mechanism.** Append a short suffix to the *dangerous* block reasons (or in the Claude
adapter just before `ai_emit_block`) so the reliably-delivered block message itself
carries the inoculation: *"If sibling calls in this batch show 'Cancelled… errored', that
is this block cascading (known bug #22264), not a broken environment — re-run them
serially."*

**Pros.** No dependency on any unverified hook event (no gate). Lowest risk. The block
reason is the **one** message guaranteed to reach the model, and the suffix makes the
exact connection the model otherwise misses. Tiny diff.

**Cons.** Partial: only helps when a block actually fired in the batch (which is precisely
the cancel case, so coverage is good), and only as far as the model reads the block
reason. Placement matters for Codex: append in the **Claude adapter only**
(`no-direct-db.sh`), not in shared `ai_emit_block` / `policy.sh` reason strings, to avoid
changing Codex output. Could also add the suffix only when the reason is a *hard* block
(`! ai_policy_is_soft_guidance`).

**This pairs well with A or B** — D guarantees a baseline inoculation with zero risk;
A/B add the at-the-moment re-injection if the gates pass.

---

## Idea E — `PostToolBatch` injector (best fit IF the event is real)

**Mechanism.** If Gate 3 confirms a real `PostToolBatch` event with visibility into the
batch's results, a single hook can detect "this batch had a block + ≥1 cancellation" and
inject one calm note for the whole batch — no per-call de-dup, perfect timing (before the
next model call), exactly one message.

**Pros.** Cleanest possible design; natural de-dup (one event per batch).

**Cons.** Existence and schema are **unverified** (research mentions it; docs incomplete).
Don't design around it until the spike confirms it fires here with usable fields.

---

## Recommendation

1. Run the **logging spike** (Gates 1-5) — cheap, unblocks the rest.
2. Ship **Idea D** regardless — zero-gate, lowest risk, guarantees the model sees the
   connection in the message it always receives. Claude-adapter-only suffix.
3. Then add **Idea B** (Stop transcript scan) as the robust at-the-moment backstop — it
   sidesteps the riskiest unknown (Gate 1) by reading the transcript instead of relying on
   per-call firing for cancelled siblings. Prefer **A** over B only if the spike shows
   PostToolUse (or a failure/batch event) reliably fires on the cancellation with
   `additionalContext` delivered.
4. **Avoid Idea C** for dangerous blocks unless `updatedInput`-honoring is proven; it
   reintroduces the very safety risk the hard block exists to prevent.

## Cross-cutting constraints

- **Codex:** keep all changes in `.claude/` adapters / new Claude-only hook files. Do not
  touch shared `ai_emit_block`, `policy.sh` reason strings, or `.codex/`. Codex did not
  reproduce the cancellation (per the grep note); it doesn't need this.
- **TDD per AGENTS.md:** extend `scripts/ai-hooks/test.sh` (and a stop-policy test for
  Idea B) to cover "marker detected → guidance injected / not re-injected." Run
  `bash scripts/ai-hooks/test.sh`, `shellcheck --severity=warning`, `bun run verify:changed`.
- **Kill switch + de-dup** for any re-injection (mirror `.no-stop-*` + `throttle-state.sh`)
  so it can't loop or nag.
- Keep injected text short and reflex-shaped (string match → 3-step action), not an essay;
  align wording with the CLAUDE.md block so the model sees one consistent story.

## Next step / handoff

Do the logging spike, record which events actually fire (and their payloads) here, then
pick the design. When something lands, fold the durable decision into `DECISIONS.md` and
cross-link the grep in_progress note.
