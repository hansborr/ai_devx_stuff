# 23 — Skill mirrors and gitignore opt-ins are outside the manifest

Status: Done
Track: T (tooling) · Priority: P2 · Size: M

> **Confirmed — 2026-07-13 adversarial triage.** The manifest and freshness checker have no skill inventory. Only agent-cli has a bespoke byte-mirror assertion, while TS Graph already demonstrates the need for explicit permitted overlays.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/harness/control-field-validation.ts:11-23` — supported control kinds do not include skills.
- `scripts/harness-check.ts:204-219` — freshness checks contain no skill generator or complete inventory.
- `scripts/tests/test-skill-dispatch-wrappers.sh:2372-2381` — byte-parity covers agent-cli only.
- `.gitignore:45` and `.gitignore:54` — both skill trees require manual allowlist opt-ins, so a new ignored skill gives no ordinary untracked-file signal.
- The TS Graph skill copies differ by a Claude-only `allowed-tools` frontmatter line, showing why intentional overlays must be modeled rather than mistaken for drift.

Failure: Playwright or TS Graph mirrors can diverge silently, and a locally working new skill can be absent from commits and public archives without any harness check failing.

## Do

Add manifest skill entries with canonical source, harness targets, and permitted overlays. Generate or validate mirrors, Codex metadata, gitignore allowlists, and smoke-subject ownership from that inventory. Extend, rather than duplicate, the agent-cli mirror work described in `../arch-review-2026-07/00-report.md`.

## Verify

```
bun run harness:check && bash scripts/tests/test-skill-dispatch-wrappers.sh
```

## Acceptance

- Every tracked skill target and gitignore opt-in is derived from or validated against one inventory.
- Intentional harness-specific frontmatter is expressed as a permitted overlay; other drift fails.
