# Devcontainer Setup

This devcontainer is built for **Podman** on a Linux host with SELinux. Most of the
non-obvious configuration exists to work around differences between Podman and Docker.
This document explains each decision so the patterns can be reused in other projects.

> **Heads up — `localhost/claude-devcontainer:latest` base image.** `Dockerfile`
> starts from a base image you build locally. It is derived from Anthropic's
> public Claude Code devcontainer
> ([anthropics/claude-code/.devcontainer](https://github.com/anthropics/claude-code/tree/main/.devcontainer))
> with additional customizations layered in via
> [hansborr/devcontainer-base](https://github.com/hansborr/devcontainer-base) —
> see that repo for the build steps. The wiring under `.devcontainer/` here
> (Podman flags, named volumes, persistence patterns) is independent of the
> base image and portable to any TypeScript/Bun-friendly base.

## Quick start

```bash
# First time only — copy and edit environment variables
cp .devcontainer/.env.example .devcontainer/.env
# Edit .devcontainer/.env — set PROJECT_NAME, POSTGRES_PASSWORD at minimum

# Open in VS Code — it will prompt to reopen in container
code .
```

`postCreateCommand` installs dependencies and runs database migrations automatically,
so the environment should be fully ready once the container starts.

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

### Shell history

```yaml
- shell-history:/commandhistory:U
```

Same principle as above. The Dockerfile configures zsh to write history to
`/commandhistory/.zsh_history` via `INC_APPEND_HISTORY`, which flushes each
command to disk immediately rather than at shell exit. The volume keeps history
intact across rebuilds.

### Git identity

```yaml
- ${HOME}/.gitconfig:/home/node/.gitconfig:ro
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
name: ${PROJECT_NAME:-myproject}

services:
  app: # fixed — matches devcontainer.json "service"
    container_name: ${PROJECT_NAME:-myproject}
  db:
    container_name: ${PROJECT_NAME:-myproject}_db
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
"postStartCommand": "sudo /usr/local/bin/init-firewall.sh",
"waitFor": "postStartCommand"
```

- **`postCreateCommand`** runs once when the container is first created. Used for
  installing dependencies and running database migrations — things that are durable
  and only need to happen once.

- **`postStartCommand`** runs every time the container starts (including after a
  host reboot). Used for the firewall init script, because iptables rules are
  ephemeral and are lost when the container stops.

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

The doctor output reports the lint tool surface, including the system binary paths
and versions for `shellcheck` and `yamllint`.

---

## Reusing this setup in another project

The Podman and persistence fixes are not project-specific. To apply them elsewhere:

1. Copy the entire `.devcontainer/` directory into the new repo.
2. Copy `.devcontainer/.env.example` to `.devcontainer/.env` and set `PROJECT_NAME`
   (and database credentials if using postgres).
3. Edit `docker-compose.yml` to add/remove services and update `forwardPorts` in
   `devcontainer.json` to match. The service name `app` and all Podman-specific
   settings can stay as-is.
4. The `mounts: []` in `devcontainer.json` is intentional: mounts that were
   previously listed there used `${devcontainerId}` in their names, which caused
   the rebuild-wipe problem. All persistent mounts now live in `docker-compose.yml`.

A future improvement would be to split the developer-specific mounts
(`claude-config`, `bash-history`, `gitconfig`) into a separate
`docker-compose.developer.yml` that lives outside the repo and is merged at
startup, so each project's compose file only contains project-specific services.
