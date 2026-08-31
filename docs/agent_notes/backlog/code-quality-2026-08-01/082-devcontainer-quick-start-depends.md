# 82. The devcontainer quick start and its copy-and-reuse pitch both depend on infrastructure the repository does not contain

Status: Landed on fix/cq-082
Theme: devcontainer bootstrap prerequisites · Area: docs · Severity: high · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Disposition

Landed as written, batched with 083 on `fix/cq-082`. `.devcontainer/README.md`
gains a Prerequisites section ahead of Quick start covering the four
undocumented host dependencies (the `localhost/claude-devcontainer:latest`
base image with its contract, the `devcontainers.slice` cgroup parent, the
external `persist` volume, and a pointer to the existing `~/.gitconfig`
requirement), and the reuse section is rewritten as a portable-vs-replace
two-column checklist. The census re-run confirmed zero runtime or
documentation consumers of `start-servers.sh`, so the helper is deleted, the
Dockerfile `COPY`/`chmod` trimmed, the lint-coverage manifest glob and count
updated, and the generated map regenerated. `initializeCommand` gained a
best-effort idempotent `podman volume create --ignore persist`, retiring
prerequisite (c). One deviation from the leaf: Prerequisites bullets cite
file plus literal value instead of `file:line`, with the values pinned by the
new `scripts/devcontainer-contract.test.ts` — a drift guard that fails
loudly where a line number rots silently. Slice 4 (base-image
parameterization) stays a split-off follow-up, as the leaf directs.

Review round 1 widened the reuse checklist past the leaf's slice-3 list
(`PROJECT_NAME` and the `POSTGRES_*` credentials): `.env.example`'s three
`*_DATABASE_URL`s and `CORS_ORIGIN` hand-duplicate values those rows tell an
adopter to change, so following the table exactly still produced a stack that
could not connect. The checklist now names all eleven keys, and a fifth
contract-test assertion fails if `.env.example` gains a key the checklist does
not. The same round repinned the firewall assertion to the literal
`/usr/local/bin/init-firewall.sh` instead of `postStartCommand`'s last token,
which would have retargeted silently on a reorder.

## Problem

A fresh contributor cannot get from `git clone` to a running devcontainer using
only what this repository ships. The documented quick start says: copy
`.env.example`, set two variables, open VS Code. What actually happens next is
that the build fails at line one — the Dockerfile builds `FROM
localhost/claude-devcontainer:latest`, an image whose `localhost/` registry reference cannot resolve in a fresh
checkout without separately provided local infrastructure and has no build source anywhere in the repo. Even with the image in
hand, Compose parents the pod into a `devcontainers.slice` cgroup that only
exists if a separate host-setup script from an external repository has been run,
and declares the `persist` volume `external: true`, so Podman refuses to start
until someone creates it by hand. A fourth dependency bites after the container
is up: `postStartCommand` runs `/usr/local/bin/init-firewall.sh`, which exists
only inside the base image.

The cost is doubled by the README's own framing. This repo is maintained as a
public harness-engineering reference, and the devcontainer README explicitly
markets its patterns for reuse: "Copy the entire `.devcontainer/` directory into
the new repo… all Podman-specific settings can stay as-is." An outside adopter
who follows that instruction inherits every one of the hidden dependencies above
plus a set of Musi-specific surfaces (ports, database provisioning, firewall
hook) the section never tells them to replace. The document that exists to make
the setup copyable is the thing that makes copying it fail.

The image also installs a second server-start executable that no tracked
runtime or README workflow invokes. Unlike the active entrypoint, that helper
does not wait for post-create setup to finish. Carrying both paths makes the
unused executable look supported while allowing its startup contract to drift
away from the actual setup-gated path.

## Evidence

- `.devcontainer/README.md:7-19` — the complete Quick start: `cp
  .devcontainer/.env.example .devcontainer/.env`, edit `PROJECT_NAME` /
  `POSTGRES_PASSWORD` / `JWT_SECRET`, then `code .`. No mention of a base
  image, cgroup slice, or persist volume.
- `.devcontainer/Dockerfile:1` — `FROM localhost/claude-devcontainer:latest`.
  The `localhost/` prefix requires local image storage or a registry reachable on the contributor's own host, and no Containerfile or
  build script for it exists in this repository.
- `.devcontainer/docker-compose.yml:3-6` — the only in-repo breadcrumb for the
  base image's origin: a comment naming the external `devcontainer-base` repo
  and its `devcontainer-rebuild.sh` script (which also installs
  `devcontainers.slice`).
- `.devcontainer/docker-compose.yml:8` — `pod_args: ["--infra=false",
  "--share=", "--cgroup-parent=devcontainers.slice"]`; the slice is supplied by
  that same external host setup.
- `.devcontainer/docker-compose.yml:90-91` — `persist:` / `external: true`;
  Podman will not create it, so first-time startup fails until `podman volume
  create` is run manually. AGENTS.md assumes its contents exist
  (`/home/node/persist/musi/pain_points.log`).
- `.devcontainer/devcontainer.json:51` — `postStartCommand` runs `sudo
  /usr/local/bin/init-firewall.sh`, shipped only in the base image; a rebuilt
  base that omits it fails after the container is otherwise up.
- `.devcontainer/README.md:233-235` — `shellcheck` and `yamllint` are "baked
  into the devcontainer base image and must be available on `PATH`" — part of
  the base-image contract that is stated only deep in the External-lint-tools
  section.
- `.devcontainer/README.md:271-283` — "Reusing this setup in another project":
  copy the directory, set env vars, adjust services/ports; "The service name
  `app` and all Podman-specific settings can stay as-is." Nothing about the
  base image, the slice, the persist volume, or the Musi-specific scripts
  (`post-create.sh`, `start-servers.sh`, `container-entrypoint.sh`,
  `init-test-db.sql`) sitting in the copied directory.
- `.devcontainer/Dockerfile:3-5` — the image copies and marks both
  `container-entrypoint.sh` and `start-servers.sh` executable.
- `.devcontainer/container-entrypoint.sh:2-17` — the active entrypoint waits
  for `.setup-complete` and only then starts `bun run dev`.
- `.devcontainer/start-servers.sh:1-4` — the second helper starts the same
  development command without the setup-sentinel check.
- Measurement — the exact pinned census
  `git grep -n 'start-servers\.sh\|/usr/local/bin/start-servers' ebf096580b31f604861fadb3d4cbd4079da4f017 -- . ':(exclude).devcontainer/Dockerfile' ':(exclude)scripts/tests/test-verify.sh' ':(exclude)docs/generated/lint-coverage-map.md' ':(exclude)docs/agent_notes/backlog/**'`
  returned zero tracked runtime or documentation consumers. The excluded
  inventory-only references are `scripts/tests/test-verify.sh:1907` and
  `docs/generated/lint-coverage-map.md:363`.
- `.devcontainer/README.md:146-148` — the one host prerequisite the README
  *does* document: `~/.gitconfig` must exist on the host or Podman errors.
  Proof the prerequisites-first pattern already exists here, just not for the
  four dependencies above.
- `.devcontainer/devcontainer.json:34` — `initializeCommand` already runs a
  host-side idempotent provisioning step (`mkdir -p /var/tmp/devcontainer-musi
  && chmod 1777 …`), the existing idiom a self-provisioning fix can extend.

## Proposed direction

Resolve the either/or (make everything self-provisioning vs document
everything) as a concrete hybrid, in four slices. Slices 1-3 plus the optional
volume-create are this leaf; slice 4 is a split-off follow-up.

1. **Prerequisites section (the core M work).** Add a "Prerequisites" section
   in `.devcontainer/README.md` immediately before Quick start that enumerates,
   each bullet citing the exact file:line it restates, everything the repo does
   not provide:
   - (a) the `localhost/claude-devcontainer:latest` base image
     (`Dockerfile:1`) — promote the comment at `docker-compose.yml:3-6` into
     the README (name the external `devcontainer-base` repo and
     `devcontainer-rebuild.sh`; do not invent new provenance), and list the
     contract the base must satisfy: `node` user at UID 1000, zsh writing
     history to `/commandhistory` (`docker-compose.yml:23`,
     `README.md:131-132`), `shellcheck`/`yamllint` on `PATH`
     (`README.md:233-235`), `/usr/local/bin/init-firewall.sh` consumed by
     `devcontainer.json:51`, and the agent CLI binaries.
   - (b) the `devcontainers.slice` cgroup parent (`docker-compose.yml:8`),
     with the exact failure symptom when it is absent and the fallback of
     deleting the `x-podman` `pod_args` override.
   - (c) the external `persist` volume (`docker-compose.yml:90-91`) — what it
     holds (cross-project agent state; AGENTS.md points at
     `/home/node/persist/musi`) and the one-line `podman volume create` that
     satisfies it.
   - (d) a pointer to the existing host `~/.gitconfig` requirement already
     documented at `README.md:146-148`.
2. **Server-start source/consumer census and deletion.** Re-run the pinned
   `start-servers.sh` census across runtime code, devcontainer configuration,
   scripts, examples, and maintained documentation before editing. If the
   current zero-consumer result holds, delete `.devcontainer/start-servers.sh`,
   remove it from both the Dockerfile `COPY` and `chmod` instructions, and do
   not carry it into the reuse checklist. Keep `container-entrypoint.sh` as the
   sole supported server-start path. If a supported consumer is discovered,
   retain the helper, document that workflow, and refactor both startup paths
   to share the setup-sentinel contract instead of deleting it.
3. **Replacement-point checklist.** Rewrite "Reusing this setup in another
   project" (`README.md:271-283`) as an explicit two-column checklist
   separating portable Podman/persistence patterns (keep as-is) from
   Musi-specific surfaces that must be replaced: the `FROM` line, the
   `pod_args` slice, the persist volume, ports 8000-8004 / `forwardPorts`
   (`devcontainer.json:42`), `PROJECT_NAME` and the `POSTGRES_*` credentials,
   `post-create.sh` (entirely Musi-specific provisioning),
   `container-entrypoint.sh`, `init-test-db.sql`, and the `postStartCommand`
   firewall/`worktree:gc` line (`devcontainer.json:51`). Write the checklist as
   a pattern (portable column vs project-specific column) — it is itself the
   reusable artifact for outside readers, not Musi trivia.
4. **Optional, consistent with the existing idiom:** make the persist volume
   self-provisioning by appending an idempotent `podman volume create --ignore
   persist` to `initializeCommand` (`devcontainer.json:34`), so prerequisite
   (c) disappears instead of being documented.
5. **Slice 4 — split off, deferrable, not this leaf:** base-image
   reproducibility. At minimum parameterize the Dockerfile (`ARG BASE_IMAGE=
   localhost/claude-devcontainer:latest` plus a compose build arg) with a
   documented public fallback image, or vendor/link a build source. Do not
   attempt to inline the full base-image build into this repo in this pack.

## Scope / caveats

- **Out of scope everywhere:** changing what `post-create.sh` provisions, the
  firewall design, the compose-duplication finding (see
  [106-root-devcontainer-compose-bootstrap.md](106-root-devcontainer-compose-bootstrap.md)),
  and the worktree credential-source finding (see
  [198-worktree-provisioning-hard-wired.md](198-worktree-provisioning-hard-wired.md)).
- **Startup boundary:** do not change post-create provisioning or
  `container-entrypoint.sh`'s setup-sentinel behavior. Deleting the unused
  helper consolidates support on that existing contract; it does not redesign
  startup.
- **Consumer-census contingency:** deletion is conditional on the zero-consumer
  result still holding at implementation time. A newly documented or executable
  supported consumer changes the action to documentation plus shared sentinel
  setup, not unconditional removal.
- **Documentation ownership:** re-verify every factual claim in the edited
  devcontainer documentation, including complete claims whose wording is only
  partially changed.
- **Drift risk:** the Prerequisites section is a new hand-maintained doc
  surface over compose/Dockerfile facts. Mitigate by having every bullet cite
  the exact file:line it restates and asserting nothing the tree does not
  literally contain.
- **Volume-create risk:** `persist` is intentionally shared cross-project user
  state. Creation must be idempotent (`--ignore`) and must never populate or
  relabel an existing volume; hosts that manage it deliberately must be
  unaffected.
- **Slice 4 risk (for the follow-up, not this leaf):** if parameterization
  changes the effective `FROM` default, or the fallback image lacks the base
  contract (init-firewall.sh, UID-1000 `node` user, lint binaries), it silently
  breaks the currently-working local setup. Keep the current default pinned and
  treat the fallback as documented-but-untested.
- **Sequencing:** no hard edges. Soft file overlaps only:
  [106-root-devcontainer-compose-bootstrap.md](106-root-devcontainer-compose-bootstrap.md)
  touches `docker-compose.yml:59` (the `init-test-db.sql` mount), while
  [198-worktree-provisioning-hard-wired.md](198-worktree-provisioning-hard-wired.md)
  changes the worktree credential resolver and adds prerequisite documentation
  to the per-worktree guide. The problems and edited files remain disjoint, so
  they require trivial merge coordination at most.
- No prior-pack coverage: the 2026-07-25 pack has no ruling on devcontainer
  bootstrap, the base image, or the duplicate startup helper.
