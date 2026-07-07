# 47. Lint-message polish batch (7 tiny fixes)

Status: Done — implemented on chore/lint-messaging-2026-07-pack; baseline-debt-accounting seam had already drifted.
Lens: mixed · Area: consistency · Severity: low · Size: S · Confidence: med
Theme: polish · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

Seven independent one-line-scale fixes. Group into one or two commits
(rule-message edits need fixture updates; shell edits don't).

## (a) FAIL-prefix dash consistency
`lint-ratchet-zero-baseline.ts:230`, `baseline-debt-accounting.ts:278`,
`default-mode.ts:83` (all under `scripts/lint-ratchet/`) mix
`<label> FAIL - ` (hyphen) and `<label> FAIL — ` (em-dash). Pick one
(em-dash matches `lint:ratchet:update OK —`) and align; anything grepping
tool output cares.

## (b) Smart quotes → backticks
`eslint-rules/socket-registry-broadcasts.js:58-59` quotes
`"{{eventName}}"` with double quotes where every sibling rule uses
backticks for inline code.

## (c) test-file-location wording
`eslint-rules/test-file-location.js:36-37` — "helpers belong outside the
test-file naming convention" reads backwards. Suggested: "If this file is
a test helper, rename it to drop the .test/.spec suffix so it stops
matching the test-file convention."

## (d) suppression-register missing-reason reword
`scripts/suppression-register.sh` (~:254) — "replace `' — '` or `': '`
with `' -- '`" implies an existing wrong separator; it also fires when
there is none. Reword to "add `' -- <reason>'` after the directive."

## (e) Trim the throttle-note prose
`scripts/ai-hooks/lint-coverage-check.sh:117-124` — the three-way
"TTL / count / new session" explanation appended to every advisory is hook
internals the agent can't act on. Collapse to one clause
("(throttled; won't repeat soon)").

## (f) failure-guidance truncation marker
`scripts/ai-hooks/failure-guidance.sh` — guidance is capped at 5 lines
(`ai_limit_lines … 5`) with no indicator when clipped. Add a "+N more"
marker like the coverage-check bullets already use.

## (g) parser-error finding adds nothing
`scripts/lint-agent-envelope.ts:97-108` — `howToFix: "Fix the syntax error
reported by ESLint: <message>"` restates the message. Drop the redundant
prefix, or add the one thing raw output lacks (e.g. "if the file should
not be parsed as TS, check `eslint --print-config <file>`").

## Scope / caveats
- (b)(c) touch rule messages: fixtures + `message-guidance.test.js` +
  lint-guidance regen. (a) may touch ratchet-report fixtures. (e)(f) have
  hook-body tests under `scripts/tests/`.
