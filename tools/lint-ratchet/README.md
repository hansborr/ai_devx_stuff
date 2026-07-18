# @musi/lint-ratchet

A portable, repo-agnostic lint-ratchet engine. It is a source-only workspace
package (no build step): consumers run under Bun and import the TypeScript
sources directly through per-layer subpath exports.

## Layers

- `kernel/` — baseline codec, current-state collection, comparison, update, and
  the injected engine context (`LintRatchetEngineContext`).
- `git-rail/` — pure merge-driver operations, merge-driver presence checks, and
  the `.git/info/attributes` block renderer.
- `governance/` — debt log, zero-baseline lifecycle audit, trend, summary,
  propose, edit-check, retirement, baseline debt-accounting, and the shared
  `WorseBaselineError`.

The package carries **layers 1–3 only**. The repo adapter — registry data,
path/context construction, harness wiring, CLI composition, and the
harness-diagnostics envelope render — stays outside the package (in Musi it
lives under `scripts/`). See
`docs/agent_notes/backlog/lint-arch-review-2026-07/02-slice-plan.md`.

## Adopting it

Copy `tools/lint-ratchet` into your repo, declare its dependencies, and write a
thin adapter that:

1. constructs a `LintRatchetEngineContext` for your repository, and
2. supplies your own ratchet registry.

`examples/lint-ratchet-demo` is a second, non-Musi adapter that proves the seam.

## Boundary invariant

Every `.ts` under this directory — the sole exception being the pinned repo
test-runner config (`vitest.config.ts`), which an adopter replaces — may import
only: a relative or self (`@musi/lint-ratchet/…`) specifier that **resolves to
an existing file** inside the package (self-imports through the `exports` map),
a `node:`/`bun:` built-in on the explicit engine allowlist, or a bare specifier
whose package root is a declared, portably-versioned dependency in this
`package.json`. No `@musi/*` other than this package itself, no repo-relative
reach, no unresolved import. The boundary checker is resolver-aware and
fail-closed; its exception set is sealed (see `ALLOWED_IGNORE_PATHS`) and the
`package structure` test pins it so no engine or test file can be excluded.
