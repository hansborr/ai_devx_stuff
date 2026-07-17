# Musi Harness: A 15-Minute Tour

This is the shortest open-run-observe path through Musi's harness engineering
reference. It proves three ideas without requiring VTT setup: controls produce
checkable wiring, a lint ratchet freezes existing debt symmetrically, and
shared hook behavior stays separate from tool-specific adapters.

Use a full Git clone for this runnable tour: the ratchet demo intentionally
enumerates Git-tracked files, so its smoke path does not run from an extracted
source archive. Archives remain sufficient for reading and copying the exported
harness surfaces, while a clone also includes the export-ignored agent process
notes.

Before starting the timer, install the root dependencies once:

```sh
bun install
```

Run the remaining commands from the repository root unless a step says
otherwise. The tour does not require PostgreSQL, Redis, migrations, seeds, or
the VTT development servers.

## Minutes 0–3: Controls and generated proof

Open [`harness.controls.json`](../harness.controls.json) beside the generated
[`Harness Controls`](generated/harness-controls.md) reference. The manifest is
the inventory; generators project its hook wiring, verification slots, skills,
and documentation into maintained outputs.

Run the consistency check:

```sh
bun run harness:check
```

Observe that the check validates the manifest against live source paths and
fails if generated wiring or documentation is stale. The concrete manifest is
Musi's adapter, not a template to copy unchanged.

## Minutes 3–12: Run the ratchet lifecycle

Open the standalone [`lint-ratchet-demo`](../examples/lint-ratchet-demo/README.md).
Its smoke path copies the demo to a temporary repository, performs a frozen
install, and exercises a green baseline, a blocked regression, an explicitly
accepted increase, and a locked-in improvement without dirtying this checkout:

```sh
cd examples/lint-ratchet-demo
bun run smoke
cd ../..
```

Observe the final `smoke OK` line. Then scan the demo's ten-minute path for the
individual commands and diagnostics hidden by the smoke runner. The important
property is symmetry: both new debt and unrecorded cleanup fail until the
committed baseline explains the change.

## Minutes 12–15: Shared bodies and thin adapters

Compare the shared Prisma-generation body with its three harness adapters:

```sh
sed -n '1,35p' scripts/ai-hooks/prisma-generate.sh
sed -n '1,25p' .claude/hooks/prisma-generate.sh
sed -n '1,25p' .codex/hooks/prisma-generate.sh
sed -n '1,35p' .copilot/hooks/prisma-generate.sh
```

Observe that the Claude and Codex shims resolve the checkout and execute one
shared body. The Copilot adapter also translates its different payload and
response shape, but still delegates policy to that body. The
[`ai-hooks` authoring reference](../scripts/ai-hooks/README.md) documents the
shim contract and the Musi-specific assumptions that adopters must replace.

## What to copy next

This ladder routes to the existing adoption authorities; it is not another
file inventory or a new set of adoption tiers.

| Commitment | Next step | Authority |
| --- | --- | --- |
| Evaluate only | Keep the runnable demo as a proof; copy nothing yet. | [`lint-ratchet-demo`](../examples/lint-ratchet-demo/README.md) |
| Adopt the lint ratchet | Choose the existing **Tier 1 — Minimal ratchet** or **Tier 2 — Full platform** path. | [Lint Ratchet Adoption](guides/lint-ratchet-adoption.md) |
| Adapt the broader harness | Separate portable machinery from Musi policy, then select only the controls and harness adapters the target repo needs. | [Portable Core And Adapters](ai-harness.md#portable-core-and-adapters) and [`ai-hooks` Porting This](../scripts/ai-hooks/README.md#porting-this) |

The [Portable Core And Adapters](ai-harness.md#portable-core-and-adapters) map
is the authoritative copy boundary. Follow it instead of deriving a copy list
from this tour or from the generated controls inventory.

## Continue: Follow a commit through the gate

The focused [commit-gate lifecycle](guides/verify-gate-lifecycle.md) follows a
source edit through pre-commit, generated slots, a real control ID, the
diagnostics envelope, and human-readable repair text.
