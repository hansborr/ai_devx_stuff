# Roadmap

The active developer-experience sprint is:

- `developer-experience.md`

That file is the canonical sprint scope for BatonLoop and agent promotion. It
contains the active DX5-DX8 work. Parked agent-driven workstreams that aren't
part of the active sprint live in `docs/agent_notes/backlog/`.

## BatonLoop configuration

BatonLoop should stop on repository state, not an agent-created marker. Use
this check shape:

```bash
! grep -nE '^- \[ \] ' docs/roadmap/developer-experience.md \
  && bun run verify:changed
```

The check returns success only when no unchecked sub-bullets remain in the
sprint roadmap and verification passes. `verify:changed` runs `lint:changed`,
`typecheck`, and `test:changed` sequentially with shared lock/log/cache
conventions; pass `FORCE_VERIFY=1` to bypass the short-circuit. Agents must
tick every `- [ ]` under a leaf's `###` heading when they complete it;
otherwise the loop runs forever.

Sizing guidance for `batonloop.toml`:

- `iterations`: at least 30. The sprint contains 19 leaves and each iteration
  completes one leaf plus promotes the next, so a 15-iteration default will
  not finish the sprint in a single run. Use BatonLoop's `--resume` if a run
  is interrupted before the stop check passes.
- `iteration_timeout`: high enough for a full sequential `verify:changed`
  pass on the changed files (the verification step that gates the stop
  check).
- `prompt_files`: a sprint-specific prompt that tells the agent to read
  `docs/agent_notes/STATUS.md`, `docs/agent_notes/NEXT.md`, and
  `docs/roadmap/developer-experience.md`, then act on the first item under
  `## Ready now`.
