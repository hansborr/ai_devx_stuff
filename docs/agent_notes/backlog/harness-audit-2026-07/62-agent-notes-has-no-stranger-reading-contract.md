# 62 — `docs/agent_notes/` has no stranger reading contract

Status: Done
Track: DOC (docs) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** A clone exposes roughly ten dated packs and around forty loose leaves, while both existing READMEs provide only agent-workflow directives. Archive-policy leaf 70 does not own clone navigability.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/agent_notes/README.md:19-24` — guidance says notes are on-demand and should stay out of session start.
- `docs/agent_notes/backlog/README.md:9-10` — backlog guidance repeats the agent-loop boundary.
- `docs/ai-harness.md:68-70` and `docs/public-release-notes.md:28-30` — agent notes are export-ignored process state, but remain visible in a full Git clone.
- The cloned tree contains numerous dated audit packs and loose notes without a visitor-oriented explanation or sample path.

Failure: A cold visitor sees dense process archaeology but cannot distinguish showcase documentation, active guidance, and historical agent state.

## Do

Add a blunt visitor banner to `docs/agent_notes/README.md`: point public harness readers to `docs/ai-harness.md`, label this tree process/session state, and offer a small representative sample such as `LOG.md`, one decision entry, and one finished leaf. Do not broaden the archive-policy task.

## Verify

```
rg -n "process state|docs/ai-harness.md|LOG.md|DECISIONS" docs/agent_notes/README.md
```

## Acceptance

- A stranger can identify why agent notes exist and where public harness guidance starts.
- The banner offers a bounded sample without presenting backlog archaeology as the tour.
