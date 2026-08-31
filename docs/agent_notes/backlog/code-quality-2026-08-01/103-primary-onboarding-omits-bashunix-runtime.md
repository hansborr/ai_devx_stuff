# 103. Primary onboarding lists no host-environment prerequisite even though its first development command requires Bash

Status: Landed on fix/cq-228
Theme: onboarding prerequisites · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The README reads as platform-neutral: its Prerequisites section asks for Bun and
Docker and nothing else. But the very first application command the setup walk-through
ends on — `bun run dev` — is `bash scripts/dev.sh` under the hood, and the same is
true of most of the everyday quality and worktree surface (63 of the 147 root
`package.json` scripts shell out to `bash scripts/...`, including `doctor`,
`verify:changed`, `lint:changed`, and the entire `worktree:*` family). A contributor
on native Windows follows the README faithfully, installs Bun and Docker, and hits a
wall at step 5 with no supported path forward: the README never mentions a host-OS
requirement, WSL, Git Bash, or the devcontainer that actually exists under
`.devcontainer/`. The failure is immediate and diagnosable, so the cost is bounded —
but for a repo positioned as a public reference, an accurate supported-host line is
one or two sentences of prevention.

## Evidence

- `README.md:26-29` — Prerequisites lists exactly two items, Bun >= 1.3.0 and
  Docker; no host OS, shell, WSL, or devcontainer requirement.
- `README.md:54-55` — the primary setup path ends with `bun run dev` ("# 5. Start
  development servers").
- `package.json:23` — `"dev": "bash scripts/dev.sh"`; the neighboring
  `worktree:*` scripts at `package.json:24-30` are all `bash scripts/worktree-*.sh`.
- Measured at the pin: 63 of the 147 root `package.json` scripts have a value
  starting with `bash `, among them `doctor`, `verify`, `verify:changed`, `lint`,
  `lint:changed`, and `format:changed`.
- `README.md` contains zero occurrences of "devcontainer", "WSL", or "Windows",
  while `.devcontainer/README.md:7-19` documents a working quick start for the
  committed devcontainer.
- `.devcontainer/README.md:3-4` — the devcontainer describes itself as "built for
  **Podman** on a Linux host with SELinux", so it is not currently documented as a
  Windows on-ramp either.

## Proposed direction

Add a supported-host line to README Prerequisites stating that development
commands require a Bash/Unix environment and pointing Windows contributors at
WSL2 or the devcontainer workflow.

Mechanics: one or two lines in the Prerequisites list at `README.md:26-29`, e.g. a
third bullet stating that development commands run through Bash (`bun run dev` is
`bash scripts/dev.sh`), that Linux and macOS are the supported hosts, and that
Windows contributors should work inside WSL2 — optionally noting the
`.devcontainer/` setup as an alternative. Keep it to the scale the section already
has; this is a prerequisites correction, not a new platform-support guide.

## Scope / caveats

- Out of scope: making any script Windows-portable, adding Git Bash or PowerShell
  support, or expanding `.devcontainer/` docs. This leaf only makes the README
  state the requirement that already exists.
- Keep the severity in proportion: native-Windows contributors are not a common
  path for this repo, and the judgment here is that one or two README lines are
  worth it — anything larger is not.
- If the pointer names the devcontainer, keep it honest: `.devcontainer/README.md:3`
  says the container is tuned for Podman on a Linux host, so present WSL2 as the
  primary Windows path and the devcontainer as a secondary option, or verify the
  devcontainer under Docker Desktop/WSL2 before promising it.
- Related leaves, no ordering dependency: [082-devcontainer-quick-start-depends.md](./082-devcontainer-quick-start-depends.md)
  covers the devcontainer quick-start's own doc gaps, and
  [106-root-devcontainer-compose-bootstrap.md](./106-root-devcontainer-compose-bootstrap.md)
  covers its compose bootstrap — if either lands first, point the README's Windows
  sentence at whatever they leave in place.
