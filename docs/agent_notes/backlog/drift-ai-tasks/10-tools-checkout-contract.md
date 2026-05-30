# 10 — Tools-checkout contract (document the supported portable run)

Status: Done
Track: P (portability MVP)
Size: small
Depends on: none
Blocks: 11, 12

## Goal

Write down the **supported "tools checkout" contract** so that running drift:ai
from a shared tools checkout against a foreign repo is reproducible and
unsurprising. Today the portable run works (validated against OpenClaw) but is
folklore — there is no doc an external user can follow. This task produces that
doc; tasks 11–14 make the runtime behavior match it.

## Background

Read `01-shared-context.md` ("The portability target", "Concrete target:
OpenClaw", "Tools checkout = this worktree") and `02-seam-map.md` §4, §12. The
core idea: **Bun is the tool runtime**; you run drift:ai from a checkout of this
repo against *another* Git repo that may use pnpm/npm/yarn and does not adopt
Bun. The target supplies the source; the tools checkout supplies the
implementation deps (`jscpd`, and later `ts-morph`/`import-x` usage).

Deeper rationale (optional): `../drift-ai-review/standalone-extraction.md` — the
coupling table and the portability proof; it also contains a starter config you
can adapt for task 13.

## Seams to touch

Doc-only — no source seams. The doc describes behavior owned by:

- jscpd resolution: `02-seam-map.md` §4 (`duplicates-runner.ts:51–104`) — task 12.
- target-selection flow: `01-shared-context.md` "How to test against
  OpenClaw / Musi" — task 11.
- config discovery: `02-seam-map.md` §10 (`drift-ai.config.json`, auto-discovered).

## What to do

1. **Write the contract doc at `scripts/drift-ai/README.md`.** This decision is
   locked. The portable tool's usage doc should travel with the tool, not with
   Musi's docs tree.

2. **Document the contract.** The doc must cover, at minimum:
   - **Location of the tools checkout.** It is a clone/worktree of this repo. No
     special path is required; the user invokes by absolute path.
   - **`bun install` owns implementation deps.** The tools checkout runs
     `bun install` once; that brings in `jscpd` (and future `ts-morph`/`import-x`
     usage). The *target* repo never installs drift:ai's deps.
   - **Invocation forms.** Canonical:
     ```sh
     cd <target-repo>
     bun <tools-checkout>/scripts/drift-ai.ts --scope current --root <src> ...
     ```
     (The validated OpenClaw command is in `01-shared-context.md` "How to test".)
   - **Target assumptions** (be explicit — these are the load-bearing
     portability constraints):
     - target **is a Git repo**;
     - target may use **pnpm / npm / yarn / bun** — any package manager;
     - target **does NOT need Bun installed**;
     - target **may have no `node_modules` installed at all** (OpenClaw didn't —
       see `01-shared-context.md`);
     - target **may be a shallow / blobless clone** (so `changed` scope may be
       unavailable — see task 14; `current` scope still works).
   - **Update flow.** When drift:ai's deps change, re-run `bun install` in the
     tools checkout. Nothing in the target changes.
   - **Config discovery.** Config is discovered from the **TARGET** repo (cwd),
     not the tools checkout. The committed `drift-ai.config.json` in this repo is
     **Musi's own config**, not a default applied to other repos.
   - **Starter configs are examples, not authoritative defaults.** Any
     `drift-ai.config.example.json` (task 13) is a copyable starting point a
     target repo adapts; drift:ai's built-in defaults (universal ignores etc.)
     are the real defaults.

3. **Cross-link the dependent tasks** so a reader knows the contract is enforced
   by behavior: jscpd resolution (task 12), target selection (task 11), graceful
   degradation on shallow/uninstalled targets (task 14), Musi-ism cleanup
   (task 13).

## Locked decisions

- **Doc location:** use `scripts/drift-ai/README.md`.
- **Starter config:** commit a generic `drift-ai.config.example.json` in task 13
  and reference it from this doc. This task only documents that the example is
  illustrative, not authoritative. If task 13 has not landed, document the
  intended example path and leave a TODO.

## Testing

Doc-only; nothing to unit-test. The contract is *validated* by tasks 11–14
actually working against OpenClaw — i.e. the doc is "true" once the validated
OpenClaw command in `01-shared-context.md` runs to exit 0 with repo-relative
paths and the dependent tasks land. Sanity-check while writing: run that command
yourself and confirm the doc's invocation form matches reality.

## Out of scope

- A target-selection wrapper script (task 11 decided docs-only).
- jscpd bin resolution (task 12).
- Any `--repo <path>` flag (explicitly deferred — see task 11).
- Generating the generic starter config block (task 13 owns it).
