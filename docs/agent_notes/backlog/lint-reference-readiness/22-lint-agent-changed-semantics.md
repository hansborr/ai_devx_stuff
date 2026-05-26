# Rename lint:agent Local-Rule Envelope

Status: Done
Order: 22

## Context

`lint:agent:changed` is intentionally not equivalent to `lint:changed`. It
scopes JS/TS-like files for the agent-facing harness envelope, and
`lint-agent.ts` turns only `local/*` diagnostics plus parser errors into
structured findings. The accepted direction is to rename the command surface so
the local-rule scope is explicit instead of trying to make it full changed-lint
parity.

## Scope

- Add explicit package-script names:
  - `lint:agent:local-rules` for the full local-rule diagnostics envelope.
  - `lint:agent:local-rules:changed` for the changed-file wrapper.
- Keep `lint:agent` and `lint:agent:changed` as compatibility aliases for one
  transition unless all internal callers can move safely in the same leaf.
- Rename or document the wrapper script only where it improves clarity; avoid a
  noisy file rename if package-script aliases give users the right interface.
- Update harness controls, generated docs, script-smoke selection, and authored
  docs so the preferred names are visible.
- Do not expand this command to full `lint:changed` parity unless a concrete
  consumer needs that behavior.

## Definition Of Done

Users and agents see the preferred `lint:agent:local-rules(:changed)` names and
can tell the command emits a local-rule diagnostics envelope, not a complete
changed-lint gate.

## Verification

- Relevant lint-agent tests if behavior changes
- Harness controls docs/checks if package scripts change
- `bun run test:scripts:changed`
- `bun run verify:changed`
