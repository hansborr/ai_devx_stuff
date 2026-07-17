# Lint Ratchet — minimal clone-and-run demo

This is the smallest working copy of the lint ratchet: one local ESLint rule, a
committed per-file baseline, and the symmetric gate that fails on any
uncommitted change to your accepted debt — in either direction. It is a real,
runnable project, not a snippet. Clone it, `bun install`, and walk the
ten-minute path below to feel the whole lifecycle.

For the concepts and the full reference, see the parent repo's
[lint system overview](../../docs/guides/lint-overview.md) and
[Lint Ratchet guide](../../docs/guides/lint-ratchet.md). This demo is the
take-home; those guides are the manual.

## What's here

| Path | Role |
| --- | --- |
| `src/app.ts` | The code under lint. Ships with **two** pre-existing `console.log` calls — the accepted debt the ratchet freezes. |
| `scripts/lint-ratchet/lint-ratchet-config.ts` | **The one file you write.** A stripped registry with a single `local/no-console-log` ratchet and no host-project imports. Copy it as your starting template. |
| `lint-ratchet.baseline.json` | The committed per-file baseline: `src/app.ts` → 2 findings. Generated, never hand-edited. |
| `eslint.config.js` | Metadata source and flat-config registration for the demo-local rule. |
| `eslint-rules/no-console-log.js` | The neutral, demo-authored local-rule example. Its diagnostic names only repairs available in any JavaScript project. |
| `scripts/`, `packages/`, and the other files under `eslint-rules/` | The **portable runtime**, copied verbatim from the parent repo's `scripts/lint-ratchet/portable-manifest.json`. You never edit these — they are the product. |
| `package.json` + `bun.lock` | Honest, standalone dependencies (`eslint`, `minimatch`, `typescript-eslint`, `zod`, `typescript`) and a committed lockfile. No symlinks into any host `node_modules`. |
| `.gitattributes` | Committed merge semantics for the two generated files: `merge=union` for the debt log (built into git, works with no installed driver) and `merge=lint-ratchet-baseline` for the baseline (the `prepare` installer supplies the clone-local driver command this file names). |

Everything under `scripts/` and `packages/`, plus
`eslint-rules/max-lines.js`, is a byte-for-byte copy of the parent repo's
portable file set. `eslint-rules/no-console-log.js` is explicitly demo-authored;
the parent sync checker protects both ownership classes. That makes the ratchet
runtime copyable without presenting the Musi-coupled max-lines policy as an
adoption example.

## Requirements

- [Bun](https://bun.sh) (the runtime; the ratchet is a Bun/TypeScript program).
- A `git`-tracked checkout: the collector enumerates files with `git ls-files`,
  so the demo files must be committed (they are, in this repo).

## The ten-minute path

Run each step from inside this directory.

### 0. Install

```sh
bun install
```

### 1. The gate is green

```sh
bun run lint:ratchet
```

The two existing `console.log` calls match the committed baseline exactly, so
the gate passes: `2 current finding(s); 0 regression(s); 0 improvement(s)`.
Accepted debt does not fail the build.

### 2. Add a finding — watch it fail

Add a third `console.log` to `src/app.ts`:

```ts
export function debugPing(): void {
  console.log("ping");
}
```

Run the gate again:

```sh
bun run lint:ratchet
```

It now **fails** (exit 1) with a regression on `src/app.ts` — count went from 2
to 3 — and prints the exact recovery command. New debt cannot slip in silently.

### 3. Accept the debt (only if it's truly intentional)

The gate told you how. Accepting debt is deliberate and leaves a reviewable
record:

```sh
bun run lint:ratchet:update -- --allow-worse \
  --reason "demo: intentionally keeping the debug ping"
```

The baseline moves to 3, and the acceptance — with your reason — is appended to
`lint-ratchet.debt-log.jsonl`. Inspect it:

```sh
bun run lint:ratchet:debt-log
```

`bun run lint:ratchet:summary` shows the remaining baseline totals at a glance —
the quick answer to "how much debt is left" without running ESLint.

### 4. Fix it and lock in the improvement

Now delete the `debugPing` function you added. The finding count drops back to
2 — an *improvement* over the committed baseline of 3. The gate fails on an
unrecorded improvement too (the ratchet is symmetric), so lock it in:

```sh
bun run lint:ratchet:update
```

The baseline returns to 2 and the gate is green again. Debt can only trend down,
and every move is a committed diff.

## Make it yours

1. Copy `scripts/lint-ratchet.ts`, `scripts/lint-ratchet/` (minus
   `lint-ratchet-config.ts`), and the other files listed in the parent repo's
   `portable-manifest.json` into your project. Never hand-list them — expand the
   manifest.
2. Replace `scripts/lint-ratchet/lint-ratchet-config.ts` with your own registry:
   pick a rule you have real debt in, scope it to a file glob, write a one-line
   `principle`.
3. `bun run lint:ratchet:update` to generate your first baseline, commit it, and
   wire `bun run lint:ratchet` into your CI and pre-commit;
   `bun run lint:ratchet:summary` shows the baseline totals at a glance.

This demo already uses a **local** rule: `eslint.config.js` registers
`eslint-rules/no-console-log.js` under `plugins.local.rules`, and the registry
selects `local/no-console-log`. Replace that file and both identifiers with your
own policy. The rule's metadata and diagnostic contain no parent-repository
paths or commands.

The merge driver, zero-baseline lifecycle, and debt-log accounting shown in the
parent guides are all portable too; this demo keeps the surface minimal so the
core loop is unmistakable. The committed `.gitattributes` names both files'
merge semantics so a collaborator's fresh clone gets them even before `prepare`
installs the clone-local driver command.
