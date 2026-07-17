# 58. Failed Bash tool calls return raw stderr only; a PostToolUseFailure hook should inject known-failure fix guidance

Status: Done — `.claude/settings.json` wires `failure-guidance.sh` with OOM/lock-holder/flaky matchers.
Lens: hooks · Area: hooks-feedback · Severity: low-med · Size: S-M · Confidence: med
Theme: failure-feedback · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

Depends on: leaf 50 (`PostToolUseFailure` is not expressible in the wiring schema).

## Problem
When a Bash tool call fails, the agent sees raw stderr and has to re-derive the repo's known remedies from scratch — remedies that are already written down in docs and memory but not on the failure hot path. Three recur: (1) full-scan ESLint OOMs at the default heap and needs `NODE_OPTIONS=--max-old-space-size=6144` (real prior pain; the fix is baked into `land.sh` but nowhere near an interactive failure); (2) known flaky tests fail under load and the triage protocol lives in `docs/generated/observed_flaky_tests.md`; (3) the hooks' own serial locks deny overlapping verify commands with holder details, where the right move is simply wait-and-retry, not diagnose. `PostToolUseFailure` (official event, currently unwireable) is the natural injection point: match the failure text, attach the known guidance as `additionalContext`, spend zero tokens re-deriving it.

## Evidence
- `scripts/harness/hook-wiring-schema.ts:2` — `PostToolUseFailure` cannot be wired today (leaf 50).
- ESLint heap pain is real and documented: `scripts/land.sh:41` (`NODE_OPTIONS="--max-old-space-size=6144" bun run verify`), `docs/agent_notes/fast-commit-toggle-handoff.md:171` and `:228` (heap guidance for full-gate commits), `docs/generated/observed_flaky_tests.md:54` (an OOM retry with a bigger heap).
- Flaky-test pointer precedent already exists in-hook: `scripts/ai-hooks/policy.sh:21` (`AI_FLAKY_NOTE` appended to failing test summaries, pointing at `docs/generated/observed_flaky_tests.md`) — this leaf extends the same idea to arbitrary failed Bash calls, not just wrapped `bun run` scripts.
- Serial locks that produce retry-shaped failures: `scripts/ai-hooks/bun-run-quiet.sh:98-106` (blocking flock with lock-wait budget, denies with holder details) and `scripts/ai-hooks/prisma-generate.sh:61-64`.
- House style to follow: `scripts/ai-hooks/output-filter.sh` — a small shared shell library of pure text-matching functions, sourced by adapters and covered by fixture tests in `scripts/ai-hooks/test.sh`.
- Emission helper exists: `ai_emit_additional_context` (`scripts/ai-hooks/common.sh:55-61`), payload readers (`ai_response_json_from_payload`, `:123-171`) already normalize exit codes/stderr shapes.

## Proposed direction
After leaf 50 lands, add `scripts/ai-hooks/failure-guidance.sh` next to `output-filter.sh` in the same style: one matcher table (pattern → guidance line) in a single shell function, adapters stay thin shims. Start with exactly these high-frequency patterns:
1. `JavaScript heap out of memory` / eslint OOM footprints → "Known: full-scan ESLint OOMs at the default heap. Retry with NODE_OPTIONS=--max-old-space-size=6144 (see scripts/land.sh:41)."
2. Failing test output whose file/test name appears in `docs/generated/observed_flaky_tests.md` (cheap grep of the doc's headings) → pointer to that doc plus the pass-in-isolation retry protocol.
3. Lock-holder denial text from the hooks' own serial locks → "Another verification holds the lock; wait for it (or check `bun run verify:async:status`) and retry — do not spawn a parallel run."
Wire via a `hookWiring` manifest entry on `PostToolUseFailure` (matcher `Bash`; Claude-only with `notes.codex` if Codex lacks the event). Emit one bounded `additionalContext` line per matched pattern; silence when nothing matches. Fixture tests for each pattern, both directions, in `scripts/ai-hooks/test.sh`.

## Scope / caveats
Verify the actual `PostToolUseFailure` payload shape (does it carry `tool_response` stderr like PostToolUse?) before building the matcher plumbing. Keep the table small and evidence-backed — every entry must cite a doc or script where the remedy already lives; this hook must never speculate. No overlap with `output-filter.sh` (which scrubs noise from *successful* runs' logs): guidance fires only on failure payloads. One commit: library + manifest entry + generated wiring + tests.
