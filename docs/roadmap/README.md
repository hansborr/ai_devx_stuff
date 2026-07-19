# Roadmap

No active roadmap sprint is currently declared.

The closed DX5-DX8 scope archive (`developer-experience.md`, closed
2026-04-28) was removed at the 2026-07-19 triage — read it from git history.
Current agent-driven work lives in `docs/agent_notes/in_progress/`; parked
workstreams live in `docs/agent_notes/backlog/`; curated recent history lives
in `docs/agent_notes/LOG.md`.

## BatonLoop configuration

BatonLoop should stop on repository state, not an agent-created marker. When a
future sprint roadmap is promoted, use this check shape with that roadmap file:

```bash
! grep -nE '^- \[ \] ' docs/roadmap/<active-sprint>.md \
  && bun run verify:changed
```

The check returns success only when no unchecked sub-bullets remain in the
sprint roadmap and verification passes. `verify:changed` runs the generated
changed-mode slot set (`MUSI_VERIFY_CHANGED_STEPS` in
`scripts/verify/steps.generated.sh`) in parallel through `scripts/verify.sh`;
pass `FORCE_VERIFY=1` to bypass the short-circuit. Agents must tick every
`- [ ]` under a leaf's `###` heading when they complete it; otherwise the loop
runs forever.

Historical sizing guidance for the closed DX5-DX8 sprint (roadmap file
in git history):

- `iterations`: at least 30. The sprint contains 19 leaves and each iteration
  completes one leaf plus promotes the next, so a 15-iteration default will
  not finish the sprint in a single run. Use BatonLoop's `--resume` if a run
  is interrupted before the stop check passes.
- `iteration_timeout`: high enough for a parallel `verify:changed` pass on the
  changed files (the verification step that gates the stop check).
- `prompt_files`: a sprint-specific prompt that tells the agent to read
  the active sprint roadmap (and `docs/agent_notes/LOG.md` for
  status context), then act on the first unchecked `- [ ]` sub-bullet in the
  sprint roadmap.
