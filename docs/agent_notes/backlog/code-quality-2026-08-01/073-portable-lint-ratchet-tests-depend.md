# 73. The portable lint-ratchet package's tests create directory symlinks, a privileged operation on Windows, with a one-word fix available

Status: Landed on fix/cq-073
Theme: Windows-portable test fixtures · Area: tests · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`tools/lint-ratchet` sells itself as portable: its `package.json` description
says "Copy this directory into your repo and bind it with a thin adapter"
and the README opens with "a portable, repo-agnostic lint-ratchet engine."
But five of its test files build fixture repositories that borrow the real
workspace's installed dependencies by calling
`symlinkSync(<real node_modules>, <fixture>/node_modules, "dir")`. On
Windows, creating a *directory symlink* requires Developer Mode or
administrator rights — a privilege a fresh contributor on a locked-down
machine typically does not have — so an adopter who copies the package and
runs its tests on stock Windows gets five suites failing with `EPERM`
before any ratchet logic executes. Nothing in the current Musi harness is
blocked (the surrounding hooks and smokes assume POSIX anyway), so the cost
is entirely to the package's copy-out story: the tests contradict the
portability claim on exactly the platform where the claim is hardest won.

Node already has the escape hatch built in: `symlinkSync`'s `type` argument
is Windows-only (ignored on POSIX), and passing `"junction"` instead of
`"dir"` creates an NTFS junction, which needs no privilege. Junction
targets must be absolute, and every one of these five targets already is —
each is `join(realRepoRoot, "node_modules")` where `realRepoRoot` comes
from `fileURLToPath(new URL(...))`.

## Evidence

- `tools/lint-ratchet/package.json:6` — the package describes itself as
  "Portable, repo-agnostic … Copy this directory into your repo";
  `tools/lint-ratchet/README.md:3` repeats the claim.
- The five `symlinkSync(..., "dir")` calls (measured: exactly five files in
  the package match `symlinkSync`):
  - `tools/lint-ratchet/test/fixture-context.test.ts:47`
  - `tools/lint-ratchet/test/operations.test.ts:52`
  - `tools/lint-ratchet/test/operations-roundtrip.test.ts:43`
  - `tools/lint-ratchet/test/operations-parse-first.test.ts:49`
  - `tools/lint-ratchet/src/governance/edit-check.test.ts:81`
- Targets are already absolute: `realRepoRoot` is
  `fileURLToPath(new URL("../../../", import.meta.url))` at
  `tools/lint-ratchet/test/fixture-context.test.ts:32`,
  `test/operations.test.ts:38`, `test/operations-roundtrip.test.ts:31`,
  `test/operations-parse-first.test.ts:36`, and (with one more `../`)
  `src/governance/edit-check.test.ts:79`.
- The intent is documented at `tools/lint-ratchet/test/fixture-context.test.ts:44-46`:
  "Borrow the installed store so the generated ESLint config … and ESLint's
  bin resolve" — the fixture only needs *a* working `node_modules`, not a
  symlink specifically.

## Proposed direction

In the five tools/lint-ratchet test files that call
`symlinkSync(join(realRepoRoot, "node_modules"), ..., "dir")`, change the
type argument to `"junction"` (ignored on POSIX, avoids the Windows
Developer-Mode symlink privilege; targets are already absolute) with a
brief comment saying why.

Mechanically: edit the one `symlinkSync` call in each of the five files
listed above, replacing the third argument `"dir"` with `"junction"`, and
add a short comment (one per call, or fold into the existing "Borrow the
installed store" comment where present) noting that `"junction"` exists so
the suites run on Windows without Developer Mode. Confirm on POSIX that the
suites still pass, e.g.
`bun run test -- tools/lint-ratchet/test/fixture-context.test.ts` (the
package is a Vitest project registered at `vitest.config.ts:37`).

## Scope / caveats

- **Do not build the dependency-injection alternative.** Injecting a
  dependency-resolution seam so fixtures avoid symlinks entirely was
  considered and rejected as over-engineering: the `type` argument change is
  a five-line, zero-risk fix that fully removes the privilege requirement.
- Out of scope: making the wider harness Windows-runnable. The bash smokes,
  husky hooks, and worktree provisioning are POSIX-assumed by design; this
  leaf only removes the privilege blocker from the package that claims
  portability.
- Prior pack: 2026-07-25 leaf 68 (CQ25-113) governs the package's
  import-closure lists and fixture-framework expansion — it does not cover
  host privileges for directory symlinks, so there is no overlap or ordering
  constraint.
- Same files, no ordering dependency:
  [067-lint-ratchet-acceptance-fixtures-emit-321.md](./067-lint-ratchet-acceptance-fixtures-emit-321.md)
  and
  [068-one-lint-ratchet-acceptance-suite-serializes.md](./068-one-lint-ratchet-acceptance-suite-serializes.md)
  restructure the same acceptance suites; if either lands first, carry the
  `"junction"` argument through any moved fixture-setup helper rather than
  re-editing five call sites.
