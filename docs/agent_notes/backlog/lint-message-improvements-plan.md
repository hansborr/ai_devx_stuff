# Lint Agent Message Improvements — Implementation Plan

Status: reviewer questions resolved; follow-up review folded in; ready to
implement. No code changed yet.

Companion to `docs/agent_notes/in_progress/lint-agent-message-audit.md` (the audit
this plan acts on). The audit's message inventory was independently re-verified
against source: every quoted message matches word-for-word (0 missing, 0 wording
errors). The only systematic discrepancy is cosmetic — the audit transcribes the
live messages' em-dashes (`—`) and one arrow (`→`) as ASCII `-`/`->`. The
in-progress audit note is disposable; this plan does not spend implementation
time correcting it.

## Goals

Make the messages agents actually read steer toward maintainable repairs instead
of mechanical code-golf, and stop the structured envelope from discarding the
best guidance the rules already carry. Five immediate changes, grouped into two
PRs, plus one deferred follow-up:

- **PR 1 (envelope + ratchet wording):** A, B, C
- **PR 2 (convention sweep + `any` wording):** D, E
- **Deferred PR 3 candidate (ratchet envelope parity):** F

A, B, C are independent of each other; D and E interact positively with A (see
§A.5). F is intentionally separate because it requires threading raw ESLint
message data through the ratchet current/comparison model, not just changing
diagnostic strings.

All work follows the repo's TDD convention (AGENTS.md): adjust/add the failing
assertion first, then change the message. Every rewritten `local/*` message must
keep passing `eslint-rules/message-guidance.test.js`, which enforces:

- `^Why: .+ How to fix: .+` shape (non-exempt rules)
- an action verb in the `How to fix:` clause, from this set: `Add, Consume,
  Delegate, Link, Move, Persist, Prefer, Remove, Rename, Replace, Resolve,
  Restore, Rethrow, Return, Try, Update, Use, rewrite`
- length ≤ 520 chars (non-exempt), no newline
- a complete `meta.docs` contract (description, principle, category, pairedGuide,
  repairKind, repairCommand iff codemod)

---

## Change A — `lint:agent` envelope: surface the rule's real fix text (highest value)

**Problem.** For `repairKind: "manual"` rules, `scripts/lint-agent.ts` sets
`howToFix` to a generic `Repair manually following the paired guide (<guide>).`
and throws away the rule's resolved `meta.messages` string — which is right there
in the ESLint JSON (`message.message`) and is the most actionable text we have.

Example (`no-explicit-any`, a manual rule):

- envelope `why` = principle: `'any' removes type checking from the value it
  touches; prefer 'unknown' with narrowing or a concrete type.` (fine)
- envelope `howToFix` = `Repair manually following the paired guide (...).`
- dropped message tail: `Prefer 'unknown' plus narrowing, an existing shared
  type, or a small local type ... keep the 'any' and suppress this exact line
  with '// eslint-disable-next-line local/no-explicit-any -- <why...>'.`

An agent consuming only the envelope gets strictly less than one reading raw
ESLint. The dropped text includes the copy-pasteable suppression syntax — the
single most useful line.

Note: `messageId` is **already** carried in the envelope
(`lint-agent.ts:171-174`, schema field `harness-diagnostics.ts:44`), so the
audit's weak-spot #3 ("add messageId plus the original message") is half done; we
only need to surface the message's fix text.

**Source.** `scripts/lint-agent.ts`
- `howToFixFor(entry)` — lines 110-121
- call site in `buildFinding` — line 166 (`howToFix: howToFixFor(entry)`)
- `message.message` is already available on the `ESLintMessage` interface
  (line 41) and is used for parser errors (line 136)

**Schema constraint.** `harnessFindingSchema` is `.strict()`
(`harness-diagnostics.ts:37-57`) — no spare field for a raw `message`. We
therefore reuse the existing `howToFix` string rather than adding a field. (No
schema change.)

### Proposed change (Variant A3-lite + terse manual fallback)

Decision: use command-first fallback text for autofix/suggestion findings, and
keep `why` sourced from `meta.docs.principle`. The command or suggestion remains
the first repair step, while the rule message's `How to fix:` tail gives agents
useful fallback guidance when an autofix declines an ambiguous case or a
suggestion does not fully resolve the diagnostic. Keeping `why` stable avoids
duplicating the rule message's usually similar `Why:` clause into the envelope.

Thread the ESLint message into `howToFixFor`; when the message follows the
`Why: … How to fix: …` shape, extract the `How to fix:` tail. Use that tail
directly for **manual** rules, and append it as fallback guidance for
**autofix** and **suggestion** rules. Keep **codemod** command-first and
unchanged because `repairCommand` is already the structured repair surface
agents need most.

This is intentionally broader than the original manual-only variant. It gives
agents useful next-step text for partial autofixes such as
`strict-shared-schemas`: `bun run lint:fix` is still the first move, but if the
diagnostic remains the envelope also says whether to add `.strict()` or use
`.passthrough()` intentionally.

For **manual** rules whose message does not use the `Why/How` convention, fall
back to the whole resolved ESLint message before the generic paired-guide text.
That keeps intentionally terse policy diagnostics useful in the envelope. For
example, `e2e-prefer-role-selectors` already says exactly what an agent should
do; `Repair manually following the paired guide (...)` is worse than preserving
that one-liner.

```ts
// the marker the message-guidance test itself splits on
const HOW_TO_FIX_MARKER = "How to fix: ";

function fixTextFromMessage(message: string): string | undefined {
  if (!message.startsWith("Why: ")) return undefined;
  const idx = message.indexOf(HOW_TO_FIX_MARKER);
  if (idx === -1) return undefined;
  const tail = message.slice(idx + HOW_TO_FIX_MARKER.length).trim();
  return tail.length > 0 ? tail : undefined;
}

function wholeMessageFallback(message: string): string | undefined {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function howToFixFor(entry: RuleDocsEntry, message: ESLintMessage): string {
  const kind = entry.repairKind;
  if (kind === "codemod") { /* unchanged */ }
  const messageFix = fixTextFromMessage(message.message);
  if (kind === "autofix") {
    return messageFix === undefined
      ? "Run `bun run lint:fix`."
      : `Run \`bun run lint:fix\`. If the diagnostic remains: ${messageFix}`;
  }
  if (kind === "suggestion") {
    return messageFix === undefined
      ? "Apply the ESLint suggestion for this diagnostic."
      : `Apply the ESLint suggestion for this diagnostic. If the diagnostic remains: ${messageFix}`;
  }
  // manual:
  return (
    messageFix ??
    wholeMessageFallback(message.message) ??
    `Repair manually following the paired guide (${entry.pairedGuide}).`
  );
}
```

Call site (line 166) becomes `howToFix: howToFixFor(entry, message)`.

`why` stays `entry.principle` — it's already a clean, guide-level statement and
the message's `Why:` clause is largely redundant. (Considered overriding `why`
from the message head too; rejected to keep the envelope stable. Easy follow-up
if the reviewer prefers full message-sourcing.)

### Considered alternatives (call out for the reviewer)

- **A1 (narrower):** only source manual-rule `How to fix:` tails. Rejected
  because it leaves autofix rules like `strict-shared-schemas` with only
  `Run \`bun run lint:fix\`.`, which is weak when the fixer declines ambiguous
  cases and the diagnostic remains.
- **A2 (terse-message broader):** for manual rules, fall back to the *whole*
  resolved message when it lacks `Why/How`, instead of the guide pointer. This
  also upgrades the exempt terse rules (e.g. `e2e-prefer-role-selectors`'s
  one-liner is already more useful than "Repair manually following the paired
  guide"). Accepted into A after follow-up review; the extra test churn is small
  and the envelope becomes strictly more useful.
- **A3 (broadest):** message-source `howToFix` for *all* repair kinds, including
  codemods. Out of scope here because codemod rules already carry the structured
  `repairCommand`.

### Tests (TDD)

`scripts/test-lint-agent.sh` drives `lint:agent` against synthetic fixture rules
(defined ~lines 30-70; current fixtures use `messages: { default: "fixture
diagnostic" }`, no `Why/How`).

1. **Add** a fixture manual rule whose message is `Why: … How to fix: <tail>` and
   assert `howToFix === "<tail>"` (exact tail, placeholders resolved).
2. **Add** fixture autofix and suggestion rules with `Why/How` messages and
   assert `howToFix` keeps the command/suggestion prefix and includes the exact
   message tail as fallback guidance.
3. **Change** the existing manual fixture with no `Why/How` so it asserts the
   whole resolved message (`"fixture diagnostic"`) appears in `howToFix`, and
   that the generic `"Repair manually"` text is absent. This covers the terse
   manual fallback.
4. codemod assertions (line 222), generic autofix fallback assertions (line 227),
   and parser-error (line 272) unchanged.

### Risk / edge cases

- Messages with multiple `How to fix: ` occurrences → first marker wins
  (consistent with the guidance test's own `split("How to fix: ")[1]`).
- Resolved message has placeholders already substituted → strictly more specific
  than the principle. Good.
- Exempt/terse manual rules → no `Why/How` → whole-message fallback. This is
  intentionally a behavior change for the structured envelope, but not for raw
  ESLint output.
- Empty messages are not expected from ESLint/local rules, but the generic
  paired-guide fallback remains as a defensive final branch.

### §A.5 Synergy with D

After D, the converted manual rules' envelope `howToFix` upgrades from the
generic guide pointer or terse whole-message fallback to the real fix text. The
converted autofix rule
(`strict-shared-schemas`) keeps `Run \`bun run lint:fix\`.` first, then gains the
message tail as fallback guidance if the diagnostic remains.

After E, the `no-explicit-any` envelope also has a stronger `why` because
`lint:agent` keeps sourcing `why` from `meta.docs.principle`.

---

## Change B — ratchet line/complexity `howToFix` nudges toward shrinking text

**Problem.** `ratchetFixText` (`scripts/lint-ratchet/diagnostics.ts:28-54`) leads
the line and complexity branches with `Reduce this file's <rule> effective line
count from N …`, which rewards deleting/compressing over a real extraction. The
normal-lint `max-lines/exceed` message already says the right thing ("split into
focused components, helpers, or types"); the ratchet envelope should match.

**Scope:** line branch (lines 35-36) and complexity branch (lines 45-46) **only**.
Leave the count branch (lines 49-53) — for a finding *count*, "reduce the count"
is literally correct, and the per-rule guidance says how.

### Proposed change

Line branch:
```
Prefer splitting the module into focused components, helpers, or types to bring this
file's ${ruleId} effective line count from ${currentLines} ${target}, or run
`${RATCHET_REGRESSION_UPDATE_COMMAND}` when the baseline movement is intentional
and reviewed.
```
Complexity branch:
```
Prefer splitting complex logic into focused components, helpers, or types to bring this
file's ${ruleId} complexity from ${currentComplexity} ${target}, or run
`${RATCHET_REGRESSION_UPDATE_COMMAND}` when the baseline movement is intentional
and reviewed.
```

Decision: use wording close to `max-lines/exceed`'s existing "Prefer splitting
the module into focused components, helpers, or types" message. The complexity
branch uses the same extraction vocabulary but targets complex logic instead of
only module size.

(The substrings `effective line count from <N>` / `complexity from <N>` stay
contiguous, so the existing `test-lint-ratchet.sh` substring assertions still
hold — see Tests. "Prefer" lower-cases cleanly to "prefer" when concatenated mid-
sentence via `lowercaseFirst`, e.g. `Run \`<codemod>\`, then prefer splitting
the module…`.)

This change also carries the §C wording ("when the baseline movement is
intentional and reviewed", dropping "in a cleanup PR").

### Tests (TDD)

- `scripts/test-lint-ratchet.sh:1066` asserts `howToFix.includes("effective line
  count from 5")` and `:1427` asserts `includes("complexity from 4")` — both
  substrings survive, but **tighten** them (or add adjacent assertions) to also
  require `"Prefer splitting"`, otherwise B is under-tested at the
  shell level.
- `scripts/lint-ratchet-baseline.test.ts`:
  - The existing `howToFix:` expectations around lines 743-832 cover
    **improvement** findings (`Run \`bun run lint:ratchet:update\`...`), not
    regression fix text. They should not change for B/C.
  - Add focused `buildEnvelope` expectations for one line regression and one
    complexity regression, asserting the new `"Prefer splitting"`
    wording and the removal of `"in a cleanup PR"`.
  - Line 933's `it("lower-cases the ratchet fix when appended to a local rule
    howToFix")` currently uses a *count* regression, so it is unaffected (count
    keeps "Reduce"). Keep it as the count-regression lower-case guard, and add a
    parallel line/complexity lower-case assertion only if the appended
    line/complexity path is otherwise untested.

### Decoupled (no change needed)

- `scripts/__fixtures__/lint-ratchet-report-regression.json` and
  `scripts/ai-hooks/test.sh`'s inline `howToFix` are hand-authored *inputs* to
  the report/hook renderers, not output of `ratchetFixText`. They don't track
  this wording (and are count-metric anyway).

---

## Change C — "in a cleanup PR" discourages recording debt in the same change

**Problem.** All three branches of `ratchetFixText` end with `… run \`<cmd>\` in
a cleanup PR when the baseline movement is intentional.` During active feature
work this reads as "don't use the escape hatch in this change," even when this
change is the right place to record the accepted baseline movement.

### Proposed change

Drop "in a cleanup PR" across all three branches:
`… or run \`${RATCHET_REGRESSION_UPDATE_COMMAND}\` when the baseline movement is
intentional and reviewed.`

The report footer (`scripts/lint-ratchet/recovery-command.ts:12`) already uses the
better "if the new findings are intentional" framing — no change there. This just
aligns the per-finding text.

### Tests

- No test asserts the literal "in a cleanup PR" (repo-wide grep: only
  `diagnostics.ts` and the audit md). Safe.
- `lint-ratchet-baseline.test.ts:899-902` asserts the recovery command
  `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` is present and
  bare `run \`bun run lint:ratchet:update\`` is absent — both still hold (the
  `--allow-worse` command is preserved verbatim). No change.

> B and C touch the same three string literals; implement together to avoid churn.

---

## Change D — convention sweep for the deferred-exempt messages

**Problem.** `eslint-rules/message-guidance.test.js`'s `EXEMPT_MESSAGE_IDS`
(lines 61-83) groups exempt messages by *why* they're terse. Two groups:

- **Intentionally terse — leave as-is:** `e2e-prefer-role-selectors`,
  `no-llm-artifacts/*`, `test-file-location/*` ("the diagnostic IS the rule"),
  `no-barrel` ("repair is the codemod command").
- **"Predates the Why/How convention … separate sweep" — convert (this change):**
  `socket-registry-broadcasts/noDirectEmit`, `strict-shared-schemas/needsExplicit`,
  `strict-trpc-input/needsStrict`, `trpc-require-output-schema/missingOutput`,
  `no-swallowed-errors/swallowedError`, `no-async-array-callbacks/{droppedPromise,
  asyncPredicate,asyncReduce,asyncMap}`.

Motivator: the tRPC-schema rule family is half-converted —
`trpc-shared-input-schema`/`trpc-shared-output-schema` already use full `Why/How`
while their siblings `strict-trpc-input`/`strict-shared-schemas`/
`trpc-require-output-schema` don't.

**Mechanics per rule:** edit `meta.messages[<id>]` to the `Why/How` shape, then
remove its entry from `EXEMPT_MESSAGE_IDS`. The guidance test then enforces the
shape automatically. RuleTester tests assert by `messageId` (and, for the two
strict-* rules, a regex on the guide URL, which the rewrites preserve), so they
keep passing. `docs/generated/local-lint-rules.md` is unaffected (the generator
renders `principle`, not messages) — but run `bun run docs:lint-guidance:check`
to confirm.

Also update `docs/guides/local-eslint-rules.md`: it currently lists
`trpc-require-output-schema/missingOutput` as a policy-shape example. After this
sweep that message becomes guidance-shaped, so replace it with a still-terse
example such as `no-llm-artifacts/leftoverEditNote` or remove that example.

### Proposed rewrites (batch 1 — clean conversions)

```
socket-registry-broadcasts/noDirectEmit:
  Why: Emitting "{{eventName}}" directly bypasses payload validation and broadcast
  logging in broadcast-registry.ts. How to fix: Use {{helper}} so the event stays
  validated and logged. See docs/guides/add-socket-broadcast.md.

strict-trpc-input/needsStrict:
  Why: A tRPC input `z.object(...)` without `.strict()` silently drops unknown
  keys, hiding client-side typos at the API boundary. How to fix: Add `.strict()`
  so unknown keys are rejected. See docs/guides/add-trpc-procedure.md.

strict-shared-schemas/needsExplicit:
  Why: Exported `*InputSchema` z.objects without an explicit unknown-key mode
  silently accept extra keys across the client/server contract. How to fix: Add
  `.strict()`, or `.passthrough()` only for intentional extra keys. See
  docs/guides/add-trpc-procedure.md.

trpc-require-output-schema/missingOutput:
  Why: A router {{method}} without `.output(...)` returns unvalidated data, so
  response-shape drift reaches clients silently. How to fix: Add
  `.output(<sharedSchema>)` before `.{{method}}(...)` to validate the response
  against a shared schema.

no-swallowed-errors/swallowedError:
  Why: This catch block only logs to console, so callers cannot detect the
  failure. How to fix: Rethrow with `cause`, return a failure value, or delegate
  to a named error handler.
```

### Proposed rewrites (batch 2 — `no-async-array-callbacks`)

Decision: convert these now in PR 2. They are already clear, but leaving the
four remaining "predates the Why/How convention" messages exempt would preserve
an artificial follow-up and keep the exemption list more complicated than it
needs to be.

These four already carry cause→effect prose; reshape into `Why/How`. Example:

```
no-async-array-callbacks/droppedPromise:
  Why: Async callbacks passed to `{{method}}` are not awaited, so the promises
  they return are dropped. How to fix: Use `for...of` for sequential work, or
  `await Promise.all(items.map(async ...))` for parallel work.
```

`asyncPredicate`, `asyncReduce`, `asyncMap` follow the same reshape (keep their
existing specific advice as the `How to fix:` clause).

Each rewrite was checked against the guidance test: `Why/How` shape present,
action verb in the fix clause (`Use`/`Add`/`Rethrow`), < 520 chars, no newline,
guide URLs preserved.

### Synergy with A

After D, the converted manual rules' envelope `howToFix` upgrades from the
generic guide pointer to the real fix text. The converted autofix rule
(`strict-shared-schemas`) keeps `Run \`bun run lint:fix\`.` first, then gains the
message tail as fallback guidance if the diagnostic remains.

---

## Change E — `no-explicit-any` wording: make the judgment call explicit

**Problem.** The current raw `local/no-explicit-any` message is directionally
right: it does not simply say "always use `unknown`"; it already permits a
line-scoped suppression when adding a type would be clutter. The remaining gap is
that the first sentence still leads with `unknown`, while Birgitta's example more
clearly tells the agent to make a judgment call about whether a type improves the
code.

The structured envelope also uses `meta.docs.principle` as `why`. Today that
principle says: `'any' removes type checking from the value it touches; prefer
'unknown' with narrowing or a concrete type.` That is accurate but loses the
intentional-boundary nuance.

### Proposed change

Update the `meta.docs.principle` and message for `local/no-explicit-any` only.
Keep the rule behavior unchanged.

Suggested principle:

```text
'any' removes type checking from the value it touches; use 'unknown', shared
types, or small local types for meaningful values, and keep intentional untyped
boundaries line-scoped with a reason.
```

Suggested message:

```text
Why: `any` removes type checking from the value it touches. How to fix: Use the
narrowest useful boundary: `unknown` plus narrowing for untrusted data, an
existing shared type for domain values, or a small local type for a key concept.
If typing this boundary would add clutter rather than catch bugs, keep the
`any` and suppress this exact line with `// eslint-disable-next-line
local/no-explicit-any -- <why this boundary is intentionally untyped>`.
```

This keeps the strongest parts of the current message (specific type options,
copy-pasteable suppression syntax) while making Birgitta's "make a judgment
call" explicit.

### Tests

- `eslint-rules/message-guidance.test.js` should continue to pass:
  - `Why/How` shape present.
  - `How to fix:` contains action verb `Use`.
  - Single line.
  - Length remains under 520 characters. Verify after writing the exact string.
- `eslint-rules/no-explicit-any.test.js` asserts by `messageId`, so it should not
  need a behavior change unless the test is tightened to assert a key substring.
- `bun run docs:lint-guidance:check` may update generated docs if it renders the
  changed principle; if so, run `bun run docs:lint-guidance` and include the
  generated doc update.

---

## Change F — deferred: give `lint:ratchet` local-rule findings message parity

**Problem.** `lint:ratchet` has the same generic local-rule repair issue as
`lint:agent`, but it is harder to fix correctly. For local-rule ratchet
regressions, `scripts/lint-ratchet/diagnostics.ts` builds `howToFix` from
`meta.docs` plus the ratchet repair text. It does not have the original resolved
ESLint message available by the time `buildEnvelope` runs, so it cannot yet
include tails like the `no-explicit-any` suppression syntax.

Do **not** fold this into PR 1. A quick string-only change would be weak because
the useful data has already been discarded.

### Proposed direction

Thread the first relevant ESLint message text and `messageId` through the ratchet
current/comparison path for message-count ratchets:

- Extend `LintRatchetCurrentItem` with optional diagnostic context, e.g.
  `firstMessage?: string` and `firstMessageId?: string`.
- In `scripts/lint-ratchet/current-collector.ts`, capture the first matching
  ESLint message while still aggregating counts normally.
- In `scripts/lint-ratchet-baseline-compare.ts`, copy that context onto
  regressions when available.
- In `scripts/lint-ratchet/diagnostics.ts`, reuse the same `How to fix:` tail
  extraction helper as Change A for local-rule regressions:
  - codemod/autofix/suggestion stay command-first.
  - manual local rules append the message-derived repair text before the ratchet
    "then reduce/restore baseline" clause.
- Keep generic core/third-party ratchets unchanged unless a separate allowlisted
  rule-guidance registry is introduced.

### Tests

- Add a focused baseline comparison test proving a new message-count regression
  carries `firstMessage`/`firstMessageId`.
- Add a `buildEnvelope` test for a local manual rule regression whose first
  message is `Why: … How to fix: <tail>`, asserting the resulting `howToFix`
  includes `<tail>` and the ratchet baseline repair instruction.
- Add a no-message fallback test so old baseline/current fixtures still produce
  the existing generic local-rule ratchet text.

### Risk / edge cases

- Ratchet findings are path-level aggregates, not individual diagnostics. Only
  carrying the first message is acceptable for agent guidance, but do not present
  it as exhaustive.
- Effective-line and complexity ratchets already have metric-specific messages;
  keep F scoped to message-count local-rule ratchets unless a later review finds
  a concrete need.

---

## Test & verification plan

Run, in order:

1. `bash scripts/test-lint-agent.sh` (Change A)
2. `bash scripts/test-lint-ratchet.sh` (Changes B, C)
3. eslint-rules vitest — `message-guidance.test.js` + each touched rule's
   `*.test.js` (Changes D, E). Run via `bun run test` (vitest) or the targeted
   file.
4. `bun run docs:lint-guidance:check` (confirm D/E leave the generated doc
   clean, or regenerate if the changed `no-explicit-any` principle changes
   generated output)
5. `bun run verify:changed` as the umbrella gate before committing (stage changes
   first; changed verification aborts on unstaged source-relevant work).

For deferred F, add targeted `lint-ratchet-baseline`/`diagnostics` coverage
before considering it part of the main verification path.

## PR grouping

- **PR 1:** A + B + C. One focused "lint message quality" change. (Branch
  already `fix/lint-messaging-v2`.)
- **PR 2:** D + E. Convention sweep for all deferred-exempt messages, including
  `no-async-array-callbacks`, plus the `no-explicit-any` judgment-call wording.
  Each converted rule is independent, so this can land incrementally if needed.
- **PR 3 candidate:** F only if ratchet-envelope parity still matters after
  PRs 1-2. Keep it separate because it changes ratchet data flow, not just
  wording.

## Resolved reviewer questions

1. **A envelope phrasing:** Keep A3-lite plus the accepted terse manual fallback.
   Use command-first fallback text for autofix/suggestion findings, keep `why`
   sourced from `meta.docs.principle`, and use the whole resolved message for
   manual diagnostics that intentionally do not use `Why/How`.
2. **B verb:** Align with `max-lines/exceed`: use "Prefer splitting..." wording
   instead of "Prefer a focused extraction...".
3. **D batch 2:** Convert `no-async-array-callbacks` now as part of PR 2.
4. **E `no-explicit-any`:** Keep the current rule's scoped suppression escape
   hatch, but tune the principle/message to say the agent should choose the
   narrowest useful boundary and avoid types that are clutter rather than
   clarity.
5. **F ratchet parity:** Defer; useful, but it requires data-flow changes.
6. **Audit note edits:** Do not edit `docs/agent_notes/in_progress/lint-agent-message-audit.md`;
   it is temporary and will be deleted when this work lands.
