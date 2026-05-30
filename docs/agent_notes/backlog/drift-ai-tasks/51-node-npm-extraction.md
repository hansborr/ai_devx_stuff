# Task 51 — Standalone Node/npm package extraction (won't do)

**Track:** X (cleanup / optional)  **Size:** medium
**Status:** Won't do
**Depends on:** a **stable tools-checkout workflow** — tasks **10–14** (checkout
/ tool-root resolution / config discovery) and **20–22** (the cleanup that makes
the tool extractable). Do not start before those land.
**Blocks:** none.

> **DECISION: WON'T DO.** Keep drift:ai as a Bun tools-checkout workflow. Do not
> pursue standalone Node/npm packaging unless this decision is explicitly
> reopened with a real distribution need.

## Goal

No current implementation. This note is retained only as historical context for
what standalone Node/npm extraction would have required if the decision is ever
reopened. The supported path remains the Bun tools-checkout workflow.

## Context

- Tool overview, layout, philosophy: `01-shared-context.md` §1–§3.
- **Why it's bun-only today** (the core blocker): source imports use
  `.js`-extension ESM specifiers (e.g. `import { run } from "./runner.js"`) even
  though the files are `.ts`. **Bun resolves `.js`→`.ts`; Node does not.** See
  `01-shared-context.md` §5 and `../drift-ai-review/standalone-extraction.md`
  (Runtime/options 1).
- Packaging shape and phase: `../drift-ai-review/standalone-extraction.md`
  (Runtime/options 2, Phase 4).
- Entry points: `scripts/drift-ai/drift-ai.ts` (CLI), `runner.ts`
  (orchestration). Seam: seam-map §1 for the exit-code contract this must
  preserve.
- Tool-root / dependency resolution is owned by the checkout tasks — coordinate
  with **task 12** (tool-root resolution) on how jscpd etc. are found.

## Historical implementation outline

Do not execute this while the task is closed. If the decision is explicitly
reopened:

1. **Add a `tsconfig` with `outDir: dist`.** Emit `.js` (+ `.d.ts`) via `tsc`.
   Once emitted, the existing `.js`-extension ESM imports become **correct** —
   they now point at real emitted `.js` files, which is exactly why the
   tsc→dist path is preferred over an on-the-fly TS loader for a published CLI.
2. **Add a `bin`** entry pointing at `dist/drift-ai.js`, with a
   `#!/usr/bin/env node` shebang on the entry file. It must run under **Node ≥18
   with no flags**.
3. **Dependency resolution.** Use npm-style resolution for runtime deps (jscpd,
   etc.). Coordinate with **task 12**'s tool-root resolution so the published
   package finds its tools the same way the in-repo path does.
4. **Package docs + config schema.** Ship package docs and a
   `drift-ai.config.json` JSON schema plus starter / example config(s) so a
   consumer in another repo can configure it without reading source.
5. **Preserve the exit-code contract** (seam-map §1, `01-shared-context.md` §3):
   default exit 0 even with findings; usage/config errors exit 2. (If task 50's
   A6 `--fail-on-findings` has landed, keep it opt-in.)

## Historical testing outline

Only relevant if the decision is explicitly reopened:

- `node dist/drift-ai.js --scope current` against a target repo must work with
  no flags under Node ≥18.
- **Parity:** the Node `dist` path must produce the same findings/output as the
  Bun in-repo path for the same target and scope (text and `--format json`).
- Keep **Bun + Vitest** as the development/test runner for tools-checkout work;
  this task adds a Node distribution path, it does not replace the Bun dev loop.
- Smoke-test the shebang `bin` (`drift-ai --scope current`) once linked.

## Out of scope

- Everything that is not distribution: no new checks, no finding/format changes,
  no philosophy changes.
- The opportunistic cleanups (task **50**) — Low-2 (`globToRegExp` as a vetted
  dep) remains closed unless this task is explicitly reopened.
- The tools-checkout workflow itself (tasks 10–14) — this task **consumes** a
  stable version of it.

## Closed decision

- **Standalone Node/npm extraction:** won't do. Leave drift:ai Bun-internal and
  supported through the tools-checkout workflow.
- The previous packaging choices (`dist` vs loader, package name/scope) are
  intentionally unneeded while this remains closed.
