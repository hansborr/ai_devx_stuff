# Devcontainer Setup

This devcontainer is built for **Podman** on a Linux host with SELinux. Most of the
non-obvious configuration exists to work around differences between Podman and Docker.
This document explains each decision so the patterns can be reused in other projects.

## Prerequisites

The Quick start below assumes four things this repository does **not** contain.
Every one of them fails at image build, pod creation, or container start —
before `postCreateCommand`, the only setup this repository documents — so check
them first. Each item names the file that declares the dependency — that file is
the authority, this list is a pointer.

### 1. Base image

`Dockerfile` builds `FROM localhost/claude-devcontainer:latest`. The
`localhost/` prefix is not a fetchable registry — it resolves only against
local image storage — and this repository ships no Containerfile or build
script for it, so a fresh checkout fails at the first line of the build.

The only in-repo record of its provenance is the comment at the top of
`docker-compose.yml`: the image is built by `devcontainer-rebuild.sh` in the
external `devcontainer-base` repository, which also installs the
`devcontainers.slice` unit covered below.

Whatever supplies the image has to satisfy the contract the rest of this
directory relies on:

- **a `node` user at UID 1000** — assumed by `docker-compose.yml`'s
  `userns_mode: "keep-id"` and `devcontainer.json`'s `"remoteUser": "node"`;
- **zsh writing history to `/commandhistory`** — the `shell-history` volume
  persists that path, but nothing in this repo configures the shell to use it
  (see [Shell history](#shell-history));
- **`shellcheck` and `yamllint` on `PATH`** — see
  [System tools](#system-tools);
- **`/usr/local/bin/init-firewall.sh`** — run by `devcontainer.json`'s
  `postStartCommand`. A rebuilt base that drops it fails *after* the container
  is otherwise up, with `waitFor: postStartCommand` holding the editor back;
- **the agent CLI binaries** (`claude`, `codex`, `copilot`, `cursor`). The
  volumes under [Other agent CLIs](#other-agent-clis-codex-copilot-cursor)
  persist their auth and history, not the binaries themselves.

### 2. The `devcontainers.slice` cgroup

`docker-compose.yml`'s `x-podman.pod_args` sets
`--cgroup-parent=devcontainers.slice` so the collective memory caps cover the
whole compose pod rather than the app container alone. The slice is a systemd
unit installed by that same external `devcontainer-rebuild.sh`. Without it
podman-compose cannot create the pod, and the stack never starts.

Fallback if you do not want the slice: delete the whole `x-podman` block from
`docker-compose.yml`. You lose the shared memory cap; nothing else depends on
it.

### 3. The `persist` volume

`docker-compose.yml` declares `persist` as `external: true`, which tells Podman
not to create it — Podman refuses to start until it exists. It is mounted at
`/home/node/persist` and holds cross-project agent state that deliberately
outlives any single project's compose stack; `AGENTS.md` points at
`/home/node/persist/musi/pain_points.log` inside it.

`devcontainer.json`'s `initializeCommand` attempts to create it for you:

```bash
{ podman volume create --ignore persist >/dev/null 2>&1 || true; }
```

`--ignore` makes an existing volume a no-op, so a host that manages `persist`
deliberately is left alone. The `>/dev/null 2>&1 || true` is deliberate: the
same `initializeCommand` prepares the scratch directory first, and a host with
no `podman` on `PATH` must not have the whole command — and with it the
container start — fail on the volume step. The cost is that a failed create is
**silent**. If Podman is absent, or too old for `volume create --ignore`, you
get no warning here and the original `volume persist not found` at first start;
create the volume by hand when you see it. Do the same if you bring the stack up
with `podman-compose` directly — `initializeCommand` is run by the devcontainer
CLI/VS Code, not by Compose.

### 4. A host `~/.gitconfig`

Already covered under [Git identity](#git-identity): the file is bind-mounted
read-only and Podman errors if it is missing. Create it first.

## Quick start

Confirm the [Prerequisites](#prerequisites) above first — all four fail before
any of this runs.

```bash
# First time only — copy and edit environment variables
cp .devcontainer/.env.example .devcontainer/.env
# Edit .devcontainer/.env — set PROJECT_NAME and POSTGRES_PASSWORD, then
# re-spell the new password into DATABASE_URL, TEST_DATABASE_URL, and
# E2E_DATABASE_URL, which hard-code it (see the reuse checklist below).
# The shipped JWT_SECRET is a known dev-only placeholder: it boots unedited in
# development but is rejected in production, so replace it with a real secret
# (openssl rand -base64 48) before any non-local use.

# Open in VS Code — it will prompt to reopen in container
code .
```

`postCreateCommand` runs [`post-create.sh`](post-create.sh), which provisions the
workspace end-to-end: installs dependencies, builds `@musi/shared`, generates the
Prisma client, (re)creates the `musi_test` / `musi_test_e2e` databases, applies
migrations, and seeds SRD reference data. It does **not** silence steps — output is
tee'd to `/tmp/musi_logs/post-create.log`, and the `.setup-complete` marker (which
gates dev-server startup) is written only when every critical step succeeds. On a
critical failure it writes `.setup-failed` and exits non-zero instead of reporting a
half-provisioned container as ready. Run `bun run doctor` to confirm the environment
is green.

---

## Podman-specific settings

### `userns_mode: "keep-id"` (docker-compose.yml)

Podman runs rootless by default, meaning containers run under your host user's UID
rather than root. Without `keep-id`, files written inside the container appear to be
owned by a different user on the host, causing permission errors on bind mounts.

`keep-id` maps the container's user (UID 1000, the `node` user) to your actual host
UID, so files created inside the container have the same ownership as files created
outside it.

**Docker equivalent:** Not needed — Docker runs a daemon as root and handles this
transparently. Remove this line if using Docker.

### `:U` flag on named volumes (docker-compose.yml)

```yaml
- claude-config:/home/node/.claude:U
- shell-history:/commandhistory:U
```

Named volumes are created with `root:root` ownership by default. With `keep-id` in
effect, the container user (non-root) cannot write to them.

The `:U` flag tells Podman to recursively `chown` the volume to match the container
user on every mount. This runs as root before the user process starts, so no sudo is
required.

**Docker equivalent:** Not needed — Docker's user namespace handling means this
doesn't cause the same problem. Remove `:U` if using Docker.

### `pull_policy: missing` (docker-compose.yml)

```yaml
db:
  image: postgres:17
  pull_policy: missing
```

Podman does not automatically pull images before starting containers the way Docker
does. `missing` tells it to pull only if the image is not already present locally,
matching the behaviour most users expect.

**Docker equivalent:** This is valid Docker Compose syntax too and is harmless to
keep.

---

## Persistence across rebuilds

A common frustration with devcontainers is losing state on rebuild. Each item below
addresses a specific thing that was being lost.

### Claude Code history and config

```yaml
- claude-config:/home/node/.claude:U
```

Claude stores its conversation history, settings, and project memory in
`~/.claude`. Using a named volume (rather than an anonymous one or a volume name
containing `${devcontainerId}`) means the same volume is reused on every rebuild.

**Why not `${devcontainerId}`?** The devcontainer spec uses this template variable
to create per-container volumes in `devcontainer.json` `mounts`. The ID changes on
every rebuild, so a fresh empty volume is created each time — wiping history.
Moving the mount to `docker-compose.yml` with a fixed name avoids this.

### Other agent CLIs (codex, copilot, cursor)

```yaml
- codex-config:/home/node/.codex:U
- copilot-config:/home/node/.copilot:U
- cursor-config:/home/node/.cursor:U
- cursor-auth:/home/node/.config/cursor:U
```

Same principle as `claude-config`: each agent CLI keeps its auth and history in a
home-directory dotfolder, and a fixed-name volume carries it across rebuilds.

Cursor is the one that splits its state: `~/.cursor` holds config, chat history,
and skills, but the login token lives separately in `~/.config/cursor/auth.json` —
hence the second `cursor-auth` volume. Persisting only `~/.cursor` looks like it
works until the next rebuild asks you to log in again.

**Binaries are not persisted here.** The CLI binaries come from the base image
(or their self-update paths), not from these volumes. Cursor's installer puts its
binary in `~/.local/share/cursor-agent` with launchers in `~/.local/bin`; if the
base image does not include it, re-run the install script after a rebuild —
the volumes above make the login and history survive it.

### Shell history

```yaml
- shell-history:/commandhistory:U
```

Same principle as above. The zsh config that writes history to
`/commandhistory/.zsh_history` via `INC_APPEND_HISTORY` — flushing each command
to disk immediately rather than at shell exit — lives in the
[base image](#1-base-image), not in this repo's Dockerfile. The volume keeps
that history intact across rebuilds.

### Git identity

```yaml
- ${HOME}/.gitconfig:/home/node/.gitconfig:ro,z
```

Bind-mounts your host `~/.gitconfig` directly into the container as read-only. Git
author name and email are set once on the host and available in every container
automatically. No need to run `git config` after a rebuild.

**Note:** If `~/.gitconfig` does not exist on the host when the container starts,
Podman will error. Create it first with `git config --global user.name "..."` and
`git config --global user.email "..."`.

If SELinux blocks the bind mount, relabel the file:

```bash
sudo chcon -t container_file_t ~/.gitconfig
```

---

## Compose project name and container names

```yaml
# docker-compose.yml
name: ${PROJECT_NAME}

services:
  app: # fixed — matches devcontainer.json "service"
    container_name: ${PROJECT_NAME}
  db:
    container_name: ${PROJECT_NAME}_db
```

```ini
# .devcontainer/.env
PROJECT_NAME=musi
```

**`PROJECT_NAME`** in `.env` is the single place to rename the project. It sets:

- The compose project name, which prefixes all volume names (e.g. `musi_postgres-data`)
- The container names (`musi`, `musi_db`, `musi_redis`), keeping `podman exec musi_db psql ...` practical

The service name (`app`) is kept fixed because `devcontainer.json`'s `"service"` field
does not support variable expansion — it must literally match a service name in the
compose file. Using a generic fixed name means `devcontainer.json` never needs editing
when you rename or copy the project.

---

## Environment variables in the app container

```yaml
app:
  env_file: .env
```

The `.env` file is loaded by Compose for variable substitution in the compose file
(e.g., `${POSTGRES_DB}` in the `db` service), but that does **not** inject variables
into container environments. `env_file: .env` on the `app` service ensures all
variables (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, etc.) are available to the
application at runtime.

---

## `postCreateCommand` vs `postStartCommand`

```json
"postStartCommand": "(cd /workspace && bun run worktree:gc >/tmp/musi_logs/worktree-gc.log 2>&1 &); sudo /usr/local/bin/init-firewall.sh",
"waitFor": "postStartCommand"
```

- **`postCreateCommand`** runs once when the container is first created. It invokes
  [`post-create.sh`](post-create.sh) to install dependencies, build `@musi/shared`,
  generate the Prisma client, provision + migrate + seed the databases — things that
  are durable and only need to happen once. Failures are surfaced (logged and
  non-zero exit), not swallowed.

- **`postStartCommand`** runs every time the container starts (including after a
  host reboot). Used for the firewall init script, because iptables rules are
  ephemeral and are lost when the container stops, and — backgrounded ahead of
  it, so it never delays the wait below — for the `worktree:gc` sweep of stale
  per-worktree state. Only the firewall half comes from the base image; see the
  `postStartCommand` row of the [reuse checklist](#reusing-this-setup-in-another-project).

- **`waitFor: postStartCommand`** prevents VS Code from connecting to the container
  until the start command completes. Without it, the editor can open before the
  firewall or other init tasks are ready.

---

## External lint tools

The lint reference checks use a small surface of tools that are intentionally split
between system binaries and npm-pinned wrappers.

### System tools

`shellcheck` and `yamllint` are baked into the devcontainer base image and must be
available on `PATH`. The current base image provides `shellcheck` at
`/usr/bin/shellcheck` and `yamllint` at `/usr/local/bin/yamllint`.

CI installs these same tools with `apt`, so they are treated as environment
prerequisites rather than project dependencies. `bun run doctor` reports the
resolved binary paths and versions so missing or mismatched local environments are
visible before commit or CI.

### npm-pinned tools

`actionlint`, `taplo`, and `hadolint` are installed by `bun install` from pinned
package.json dependencies:

- `@tktco/node-actionlint`
- `@taplo/cli`
- `hadolint`

These do not need separate system installation inside the devcontainer.

### Checking the tool surface

Run the full environment check from the workspace root:

```bash
bun run doctor
```

The doctor output reports the full lint tool surface: the system binary paths and
versions for `shellcheck` and `yamllint`, plus a `=== lint tools ===` section that
reports the resolved path, installed version, and known-good version for `eslint`,
`prettier`, `taplo`, `node-actionlint`, `hadolint`, and `bun`. Each known-good
version is read from its single source (package.json for the npm-managed tools,
`scripts/lint-config-sensors.sh` for the hadolint binary pin, and the
`packageManager` field for Bun); doctor reports versions but never installs.

---

## Reusing this setup in another project

Copying `.devcontainer/` wholesale does not work. The directory mixes portable
Podman/persistence patterns with Musi-specific surfaces, and everything under
[Prerequisites](#prerequisites) comes along with the copy. Split it into two
columns: keep the first, replace the second.

### Keep as-is — the portable patterns

| Pattern | Where | Why it travels |
| --- | --- | --- |
| `userns_mode: "keep-id"` | `docker-compose.yml` | Rootless-Podman UID mapping; nothing project-specific |
| `:U` on named volumes | `docker-compose.yml` | Podman volume ownership; nothing project-specific |
| `pull_policy: missing` | `docker-compose.yml` | Podman image-pull behaviour |
| The fixed service name `app` | `docker-compose.yml`, `devcontainer.json` | `"service"` does not expand variables, so a generic name means `devcontainer.json` never needs editing on a rename or copy |
| `mounts: []` | `devcontainer.json` | Deliberately empty; `${devcontainerId}` mounts are what caused the rebuild-wipe |
| Fixed-name state volumes (`claude-config`, `codex-config`, `copilot-config`, `cursor-config`, `cursor-auth`, `shell-history`) | `docker-compose.yml` | Agent and shell state across rebuilds; only the compose project prefix changes |
| `${HOME}/.gitconfig` read-only bind mount | `docker-compose.yml` | Host git identity, any project |
| `/var/tmp/...:/tmp` disk-backed scratch | `docker-compose.yml`, `devcontainer.json` `initializeCommand` | Works around a small tmpfs `/tmp`; only the directory name is project-specific |
| `PROJECT_NAME` as the single rename point | `.env`, `docker-compose.yml` | The mechanism is portable; the value is not |
| Gating server start on a post-create sentinel | `container-entrypoint.sh` | The shape travels — see the replace table for the body |

### Replace — Musi-specific surfaces

| Surface | Where | Replace with |
| --- | --- | --- |
| `FROM localhost/claude-devcontainer:latest` | `Dockerfile` | Your own base image, satisfying the contract in [Base image](#1-base-image) — or a public image plus your own tool installs |
| `--cgroup-parent=devcontainers.slice` | `docker-compose.yml` `x-podman` | Your own slice, or delete the `x-podman` block entirely |
| The external `persist` volume, its `/home/node/persist` mount, and the `podman volume create --ignore persist` in `initializeCommand` | `docker-compose.yml`, `devcontainer.json` | Drop all three unless you also keep cross-project state outside the project stack |
| `PROJECT_NAME`, `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`, `JWT_SECRET` | `.env` (from `.env.example`) | Your project's name and credentials |
| `DATABASE_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN` | `.env` (from `.env.example`) | Nothing derives these — each one hand-repeats a value from the rows above and below, and must be re-edited in lockstep. The three `*_DATABASE_URL`s each spell out `POSTGRES_USER`, `POSTGRES_PASSWORD`, the `db` service name, and a database name (`musi`, `musi_test`, `musi_test_e2e` — `post-create.sh` reads the last two names back out of these URLs and creates those databases); `REDIS_URL` spells out the `redis` service name; `CORS_ORIGIN` spells out the frontend port |
| Ports 8000, 8001, 8002, 8003, 8004 | `docker-compose.yml` `ports`, `devcontainer.json` `forwardPorts` + `portsAttributes` | Your services' ports — the two files are hand-kept in step, so change both |
| `/var/tmp/devcontainer-musi` | `devcontainer.json` `initializeCommand` | Your project's scratch directory name. Compose already writes this path as `/var/tmp/devcontainer-${PROJECT_NAME}`, so the `PROJECT_NAME` row covers that side; `initializeCommand` does not expand variables and hard-codes the name |
| The `db` and `redis` services | `docker-compose.yml` | Your backing services, or delete them and their `depends_on` entries |
| `../init-test-db.sql` | `docker-compose.yml` db volume mount | Your test-database bootstrap — the file itself lives at the repo root, single-sourced with the root Compose stack — or delete the mount |
| `post-create.sh` | `devcontainer.json` `postCreateCommand` | Entirely Musi provisioning (bun install, `@musi/shared` build, Prisma generate, database create/migrate/seed). Keep the fail-loud `.setup-complete` / `.setup-failed` protocol, rewrite the steps |
| `container-entrypoint.sh` | `Dockerfile` `COPY`, `docker-compose.yml` `command:` | Keep the sentinel wait; replace `bun run dev` and the `worktree:gc` sweep |
| `postStartCommand` | `devcontainer.json` | `bun run worktree:gc` is Musi's; `sudo /usr/local/bin/init-firewall.sh` is your base image's, if it has one |
| The VS Code `extensions` list | `devcontainer.json` | Your stack's extensions (`Prisma.prisma` and the ESLint/Prettier pair are stack choices) |

Between them the two `.env` rows name every key `.env.example` ships except
`TZ`, which is a host preference rather than a project surface.
`scripts/devcontainer-contract.test.ts` fails if a key is added to
`.env.example` without being named here.

A future improvement would be to split the developer-specific mounts
(`claude-config`, `shell-history`, `gitconfig`) into a separate
`docker-compose.developer.yml` that lives outside the repo and is merged at
startup, so each project's compose file only contains project-specific services.
