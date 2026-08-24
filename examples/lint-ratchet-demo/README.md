# Lint Ratchet — minimal adoption example

This is the smallest working consumer of the portable
[`@musi/lint-ratchet`](../../tools/lint-ratchet) engine: one local ESLint rule, a
committed per-file baseline, and the symmetric gate that fails on any uncommitted
change to your accepted debt — in either direction. A thin, demo-owned **adapter**
binds the package to this project; the engine itself carries no repository
bindings.

For the concepts and the full reference, see the parent repo's
[lint system overview](../../docs/guides/lint-overview.md) and
[Lint Ratchet guide](../../docs/guides/lint-ratchet.md). This demo is the
take-home; those guides are the manual.

## What's here

| Path | Role |
| --- | --- |
| `src/app.ts` | The code under lint. Ships with **two** pre-existing `console.log` calls — the accepted debt the ratchet freezes. |
| `scripts/lint-ratchet.ts` | **The adapter you write.** A minimal CLI that wires the demo's registry/binding to the package's kernel + governance operations and renders its *own* result envelope (proving the engine dictates neither the CLI surface nor the output format). |
| `scripts/lint-ratchet/adapter.ts` | The demo's whole binding to the engine: its repo paths, one-ratchet registry, `LintRatchetEngineContext`/`LintRatchetEngineBinding`, and the typed git-rail binding consumed by the package executable. |
| `lint-ratchet.baseline.json` | The committed per-file baseline: `src/app.ts` → 2 findings. Generated, never hand-edited. |
| `eslint.config.js` + `eslint-rules/no-console-log.js` | The demo-local rule and its flat-config registration. The rule's diagnostic names only repairs available in any JavaScript project. |
| `.gitattributes` | Committed merge semantics for the two generated files: `merge=union` for the debt log (built into git) and `merge=lint-ratchet-baseline` for the baseline (the installed clone-local driver). |

The engine lives in `@musi/lint-ratchet`, resolved as a workspace dependency —
there is no copied-in engine mirror and no sync manifest to keep in step.

## Requirements

- [Bun](https://bun.sh) (the runtime; the ratchet is a Bun/TypeScript program).
- A `git`-tracked checkout: the collector enumerates files with `git ls-files`,
  so the demo files must be committed (they are, in this repo).
- util-linux `flock` for the optional merge-driver step 4. It is present on
  stock Linux; on macOS, install it with `brew install flock` (or install
  util-linux).

## The ten-minute path

Run each step from inside this directory. (`bun install` once at the monorepo
root links the `@musi/lint-ratchet` workspace dependency.)

### 1. The gate is green

```sh
bun run lint:ratchet
```

The two existing `console.log` calls match the committed baseline exactly, so the
gate prints `{"tool":"lint-ratchet-demo","status":"ok",...}` and exits 0. Accepted
debt does not fail the build.

### 2. Add a finding — watch it fail

Add a third `console.log` to `src/app.ts`:

```ts
export function debugPing(): void {
  console.log("ping");
}
```

Run the gate again — it now **fails** (exit 1) with `"status":"regressed"` on
`src/app.ts` and prints the exact recovery command. New debt cannot slip in
silently.

### 3. Accept the debt (only if it's truly intentional)

```sh
bun run lint:ratchet:update -- --allow-worse \
  --reason "demo: intentionally keeping the debug ping"
```

The baseline moves to 3, and the acceptance — with your reason — is appended to
`lint-ratchet.debt-log.jsonl`. Inspect that file to see the reasoned record.

### 4. Fix it and lock in the improvement

Delete the `debugPing` function you added. The finding count drops back to 2 — an
*improvement* over the committed baseline of 3. The gate fails on an unrecorded
improvement too (the ratchet is symmetric), so lock it in:

```sh
bun run lint:ratchet:update
```

The baseline returns to 2 and the gate is green again. Debt cannot change
silently: an increase requires `--allow-worse`, a recorded reason, and a
committed acceptance record; a decrease requires updating and committing the
tighter baseline.

## Make it yours

1. Copy `tools/lint-ratchet` into your repo (or add it as a dependency) — the
   whole portable engine, no pruning.
2. Write a thin adapter like `scripts/lint-ratchet.ts` + `scripts/lint-ratchet/adapter.ts`:
   construct a `LintRatchetEngineContext`/`LintRatchetEngineBinding` over your repo
   root and a `LintRatchetWorkflowVocabulary` naming your repository's actual
   recovery commands—including distinct regression and debt-accounting commands
   when their human-facing reason placeholders differ—declare your registry (pick a rule you have real debt in, scope it to a
   file glob, write a one-line `principle`), and render whatever result envelope
   your CI wants. The binding defaults local rules to `eslint-rules` and generated
   configs/caches to `node_modules/.cache/eslint-ratchet`; set its optional
   repository-relative `localRulesDirectory` and `cacheDirectory` fields when
   your project uses another layout.
3. Before `bun run lint:ratchet:update`, prove the installed dependency tree
   matches the lockfile, because the generated baseline pins the installed
   eslint/typescript-eslint versions. Keep that check in the adapter (or inject
   an optional adapter hook) so the portable engine does not inherit one package
   manager's lockfile convention. Musi's adapter invokes its existing
   `scripts/dependency-freshness.sh` signal and refuses stale or missing installs;
   equivalent adapters should fail with an install-and-retry instruction. Then
   generate and commit the first baseline and wire `bun run lint:ratchet` into
   CI and pre-commit.
4. Add the package-owned git-rail scripts from this demo's `package.json`, then
   run `bun run lint:ratchet:install-merge-driver` once in each clone. The
   installer reads the typed binding exported by your adapter and generates the
   fixed Git-command shim in the common Git directory; no `scripts/git/*` copy
   is needed. Keep the two `.gitattributes` rows so a fresh clone names both
   generated files' merge semantics before its local driver is installed.

`smoke.sh` proves this whole path in genuine isolation: it copies the package and
this demo into a throwaway Bun workspace off the Musi checkout, installs, and
walks the adoption steps with the merge driver included.
