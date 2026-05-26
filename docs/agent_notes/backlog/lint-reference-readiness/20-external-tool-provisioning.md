# External Tool Provisioning

Status: Done
Order: 20

## Context

ShellCheck and yamllint are loaded from `PATH`. Some other config sensors use
pinned npm wrappers. CI installs Bun dependencies but does not explicitly
install system ShellCheck/yamllint.

## Scope

- Add one bootstrap script or workflow step that provisions required system
  lint tools for CI.
- Keep npm-wrapper tools pinned in `package.json`.
- Make `doctor` report versions, not just presence, for system lint tools.
- Ensure missing or wrong tools produce one actionable error.

## Definition Of Done

A fresh GitHub runner has the required system lint tool surface, and `doctor`
reports the versions used.

## Verification

- CI/bootstrap script smoke where practical
- `bun run doctor` or the relevant doctor JSON test
- `bun run verify:changed`
